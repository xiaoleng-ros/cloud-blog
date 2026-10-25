import { NextResponse } from 'next/server'
import { resolveStorageConfig } from '../../../lib/supabase-storage'
import { scheduleLazyGc } from '../../../lib/comment-image-gc'
import { clientIp } from '../../../lib/client-ip'

/**
 * 访客评论配图上传。
 *
 * POST /api/comment-image   multipart/form-data: { file }
 * → { url: 'https://<ref>.supabase.co/storage/v1/object/public/<bucket>/comments/...' }
 *
 * 为什么要一个自建端点：Waline 客户端的 `imageUploader` 只是个 `(file) => Promise<url>`，
 * 不配置时回落到内置实现 —— 用 FileReader 转 base64 塞进评论正文，且**硬上限 128KB**
 * （client dist 里 `if (e.size > 128e3) throw 'File too large!'`）。手机照片基本必失败，
 * base64 还会把几 MB 字符串写进 wl_comment.comment。
 *
 * 这里复用的是 media 集合那套 Supabase Storage（同一个 bucket、同一份 S3 凭据），
 * 对象落在 `comments/` 前缀下，和文章封面分开，将来单独统计/清理不会互相牵连。
 * bucket 已是公开读，所以返回的是 Storage 的公开地址，浏览器直连，不经过 CMS 转发。
 *
 * 安全边界（这是个**不需要登录**的写入口，必须自己兜住）：
 *   1. 类型白名单 + magic bytes 双校验（不能只信 Content-Type）
 *   2. 单文件 3MB 上限（前端已压到 200KB 上下，这是兜底）
 *   3. 同 IP 每小时 30 张的进程内限流
 * 多实例部署时进程内限流会各自计数，但 EdgeOne 是单函数实例，够用。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 3 * 1024 * 1024
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 30

/** Content-Type → 落盘扩展名 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 文件头校验：挡住改扩展名/伪造 Content-Type 的二进制 */
function sniffType(buf: Buffer): keyof typeof ALLOWED_TYPES | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a'))
    return 'image/gif'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp'
  return null
}

/** 进程内限流：IP → 最近一小时的成功上传时间戳 */
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  // 顺手清掉过期条目，避免 Map 无限增长
  if (hits.size > 5000) {
    for (const [key, arr] of hits) {
      if (!arr.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(key)
    }
  }
  return false
}

const errorJson = (message: string, status: number) =>
  NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * 把上传异常压成一段**不含任何敏感信息**的短码，拼进 502 文案。
 *
 * 线上（EdgeOne 云函数）没有交互式日志，`console.error` 也捞不出来，只剩一句
 * 「图片上传失败，请稍后重试」——凭据错、端点写错、出口被拦、SDK 没进函数包
 * 这四种原因在现场完全无法区分，每次都要重新部署一轮做二分。
 *
 * 这里只回显「异常类名 + HTTP 状态 + SDK 错误码」，三者都是公开语义、不含密钥，
 * 但足以一眼分辨：
 *   - `NotFound 404`        → 端点路径不对（少了 /storage/v1/s3）
 *   - `SignatureDoesNotMatch 403` → 密钥/ref 对不上
 *   - `ENOTFOUND` / `EAI_AGAIN` / `fetch failed` → 函数出口到不了该域名
 *   - `ERR_MODULE_NOT_FOUND` → SDK 没进函数包
 */
function uploadErrorCode(error: unknown): string {
  const e = error as {
    name?: string
    code?: string
    $metadata?: { httpStatusCode?: number }
    cause?: { name?: string; code?: string }
  }
  const parts: string[] = []
  if (e?.name) parts.push(e.name)
  const status = e?.$metadata?.httpStatusCode
  if (status) parts.push(String(status))
  const code = e?.code ?? e?.cause?.code
  if (code && code !== e?.name) parts.push(String(code))
  return parts.filter(Boolean).join(' ') || 'unknown'
}

/**
 * 上传失败的现场取证：回答「是包没打进去」还是「函数出不去网」。
 *
 * 这两件事在代码层面完全同构（都是 catch 里一个异常），但处置方式相反：
 * 缺包要改 next.config 的 outputFileTracingIncludes，出不去网只能换域名或改用
 * 平台自带的对象存储。既然线上没有日志、只能靠响应体，就把两个判据一次性带出来。
 *
 * 注意：只回显「阶段名 + 可达性结论」，绝不回显端点主机名与密钥。
 */
async function probeUploadFailure(error: unknown, endpoint: string): Promise<string> {
  const parts = [uploadErrorCode(error)]

  // 判据一：SDK 能不能被解析。ERR_MODULE_NOT_FOUND / Cannot find module 表示没进函数包。
  const errName = (error as { name?: string })?.name ?? ''
  const errMsg = String((error as { message?: string })?.message ?? '')
  if (/MODULE_NOT_FOUND|Cannot find (module|package)/i.test(`${errName} ${errMsg}`)) {
    parts.push('sdk-missing')
    return parts.join(' ')
  }

  // 判据二：从函数运行环境打一次裸 HTTP 到端点所在主机的根路径。
  // 只关心「能不能建连」，所以任意状态码（连 403/404）都算通，抛异常才算不通。
  const origin = (() => {
    try {
      return new URL(endpoint).origin
    } catch {
      return null
    }
  })()
  if (origin) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    try {
      const res = await fetch(origin, { method: 'HEAD', signal: ctrl.signal })
      parts.push(`net-ok-${res.status}`)
    } catch (netErr) {
      const n = netErr as { name?: string; cause?: { code?: string } }
      parts.push(`net-fail-${n?.cause?.code ?? n?.name ?? 'unknown'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  return parts.join(' ')
}

export async function POST(request: Request) {
  const { endpoint, bucket, publicBase, accessKeyId, secretAccessKey, ready } = resolveStorageConfig()

  // 逐个判空而不是只看 ready：既做运行时兜底，也让 TS 能把 string | undefined 收窄
  if (!ready || !endpoint || !bucket || !publicBase || !accessKeyId || !secretAccessKey) {
    console.error('[comment-image] 对象存储未配置，无法接收评论配图')
    return errorJson('图片上传暂不可用', 503)
  }

  // 与 waline 侧同口径：走共享的 clientIp()（从 XFF 右侧取合法 IP）。
  // 原先在这里取首段，同样能被 `curl -H 'X-Forwarded-For: 1.2.3.4'` 绕过，
  // 一小时 30 张的上传配额形同虚设 —— 攻击者可以无限往对象存储塞图片。
  const ip = clientIp(request) || 'unknown'
  if (rateLimited(ip)) return errorJson('上传太频繁，请稍后再试', 429)

  // 先看 Content-Length 再读 body。
  //
  // 原来的顺序是「直接 await request.formData()，拿到 File 后再判 size」——
  // 那意味着无论多大都会先把整个请求体读进内存。匿名上游挂一个 2GB 的
  // multipart 请求就能把函数内存打满（EdgeOne 函数内存有硬上限，超了直接崩），
  // 而 multipart 的分段头开销很小，给一个 4MB 的上限足够容纳 3MB 图片 + 边界。
  // 拿不到 Content-Length（chunked）时不拦，仍由下面的 file.size 兜底。
  const declaredLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 1024 * 1024) {
    return errorJson('请求体过大（单张上限 3MB）', 413)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorJson('请求必须是 multipart/form-data', 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) return errorJson('缺少 file 字段', 400)
  if (file.size <= 0) return errorJson('文件为空', 400)
  if (file.size > MAX_BYTES) return errorJson('图片太大（单张上限 3MB）', 413)

  const declared = ALLOWED_TYPES[file.type]
  if (!declared) return errorJson('只支持 JPG / PNG / WebP / GIF', 415)

  const buf = Buffer.from(await file.arrayBuffer())
  const sniffed = sniffType(buf)
  if (!sniffed) return errorJson('文件内容不是有效图片', 415)
  // 声明与实际不一致时以实际为准（某些浏览器对 webp/heic 的 type 判断不准）
  const ext = ALLOWED_TYPES[sniffed]
  const contentType = sniffed

  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const key = `comments/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`

  try {
    // 动态引入：AWS SDK 的条件导出对打包器不友好，运行时 require 更稳，也不额外增大函数包
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      endpoint,
      region: 'us-east-1', // Supabase 的 S3 兼容层固定这个 region
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // Supabase 不支持虚拟主机风格（域名不解析）
    })
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
        // 文件名是 uuid，内容永不变化 → 可以长缓存，省得多耗流量
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
  } catch (error) {
    console.error('[comment-image] 上传失败:', error)
    // 文案带上短码：线上没有日志可看，这是唯一能在浏览器里直接读到失败原因的通道。
    // 只含类名 / HTTP 状态 / SDK 错误码 / 可达性结论，不含端点主机名与任何密钥。
    return errorJson(`图片上传失败（${await probeUploadFailure(error, endpoint)}），请稍后重试`, 502)
  }

  const encoded = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  // 上传成功才触发回收：没有新图就没有新垃圾，顺手把过期的清掉
  scheduleLazyGc()

  return NextResponse.json(
    { url: `${publicBase}/${bucket}/${encoded}` },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
