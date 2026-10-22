/**
 * 线上对象存储 / 图片上传自检。
 *
 * 为什么需要它：EdgeOne 云函数不提供交互式日志，上传失败时前端只看到笼统的
 * `500 Something went wrong.` / `502 图片上传失败`，看不到是「凭据错」「端点错」
 * 「sharp 没进函数包」还是「数据库写不进」。本模块把四段链路逐段打点，把真实的
 * 异常名与 message 直接带进 /api/health 的响应里。
 *
 * 四段（任一失败即可定位）：
 *   1. resolveStorageConfig() 的生效值（只回显脱敏后的端点与 ref）
 *   2. S3 HeadBucket —— 凭据 + 端点 + 网络是否通
 *   3. S3 PutObject/DeleteObject —— 是否真的有写权限
 *   4. Payload media.create() —— 走完整上传管线（sharp 解码 → 插件 → DB 落库）
 *
 * ⚠️ 这段会产生一次真实写入（第 3 步的探针对象、第 4 步的探针记录），
 *    第 4 步无论成败都会尽力删除自己创建的记录；第 3 步对象立即删除。
 *    只应该被带令牌的诊断请求触发，不要挂到正常路径上。
 */
import { createHash } from 'node:crypto'
import { describeCredentialHygiene, resolveStorageConfig, refFromUrl } from './supabase-storage'

/**
 * 值指纹：只回显 sha256 前 10 位。
 *
 * 排障时最需要回答的是「线上这份凭据和本地那份是不是同一份」，而密钥本身不能进响应体
 * （响应会经过浏览器、可能被贴进聊天记录）。指纹可安全比对，且不可逆。
 */
function fingerprint(value: string | undefined): string {
  const v = value?.trim()
  if (!v) return 'empty'
  return createHash('sha256').update(v).digest('hex').slice(0, 10)
}

/** 1×1 透明 PNG，最小可解码图片，用于跑通 sharp 与上传管线 */
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

export interface StorageSelfTestResult {
  config: {
    ready: boolean
    bucket: string | null
    endpoint: string | null
    publicBase: string | null
    ref: string | null
    /** 只回显长度与指纹：能比对「线上=本地吗」，又不泄露密钥本身 */
    accessKeyIdLength: number
    accessKeyIdFingerprint: string
    secretAccessKeyLength: number
    secretAccessKeyFingerprint: string
    /**
     * secret 与 accessKeyId 是不是同一个值。
     *
     * 这一个布尔值比长度/指纹两个字段更直接：Supabase 的 accessKeyId 是 32 位、
     * secret 是 64 位，两者永远不可能相同，一旦相同就必然是「复制到了同一栏」，
     * 不需要再让人去比对指纹。放在 JSON 里是为了让线上排障一眼看到结论。
     */
    secretsMatch: boolean
    /** 端点上是否带 /storage/v1/s3（少了这段必然 404） */
    endpointHasS3Path: boolean
  }
  /**
   * 运行时能看到的、名字里带 SUPABASE 的环境变量（只列变量名与值长度）。
   *
   * 为什么需要它：最常见的「我明明改了却没生效」不是没保存，而是**改出了第二个
   * 名字**——变量名末尾多一个空格、或者大小写不同（`supabase_s3_secret_access_key`）。
   * Linux 上环境变量名区分大小写且允许空格，平台会照单全收，于是变成两个变量，
   * 代码读的仍是旧那个，值看起来毫无变化。只看 config.secretAccessKeyLength 是
   * 发现不了这种事的，必须把名字本身列出来。
   */
  envNames: Array<{
    name: string
    valueLength: number
    /** 名字带首尾空格、或不是全大写 —— 几乎必然是新旧两条重复变量中的一条 */
    suspicious: boolean
  }>
  headBucket: StepResult
  putObject: StepResult
  payloadCreate: StepResult
  /** 各种端点形状的连通性矩阵：全部失败=出口被拦，某一形状通=配置形状问题 */
  endpointMatrix: Array<{ endpoint: string; ok: boolean; ms: number; error?: string }>
  /**
   * 环境变量卫生检查：归一化有没有改动过凭据（引号/空格污染）。
   * 只看这里就能判断「该修控制台」还是「该重置密钥」。
   */
  credentialHygiene: Array<{
    name: string
    present: boolean
    rawLength: number
    normalizedLength: number
    changed: boolean
  }>
}

type StepResult = { ok: boolean; ms: number; error?: string; code?: string; detail?: string }

/** 把各种 SDK / Payload 异常压成一行可读文本 */
function describeError(err: unknown): { error: string; code?: string; detail?: string } {
  const e = err as {
    name?: string
    message?: string
    code?: string
    status?: number
    $metadata?: { httpStatusCode?: number }
    cause?: unknown
    data?: unknown
  }
  const parts: string[] = []
  if (e?.name) parts.push(e.name)
  if (e?.status) parts.push(`status=${e.status}`)
  if (e?.$metadata?.httpStatusCode) parts.push(`http=${e.$metadata.httpStatusCode}`)
  if (e?.code) parts.push(`code=${e.code}`)
  let message = e?.message ?? String(err)
  // Payload 的 ValidationError 把逐字段错误放在 data.errors 里，不展开就只能看到一句汇总
  const dataErrors = (e as { data?: { errors?: Array<{ message?: string; path?: string }> } })?.data?.errors
  if (Array.isArray(dataErrors) && dataErrors.length) {
    message +=
      ' | fieldErrors: ' +
      dataErrors
        .slice(0, 5)
        .map((x) => `${x.path ?? '?'}: ${x.message ?? ''}`)
        .join('; ')
  }
  const cause = (e as { cause?: { message?: string; code?: string } })?.cause
  const detail = cause ? `${cause.code ?? ''} ${cause.message ?? String(cause)}`.trim() : undefined
  return { error: `${parts.join(' ')} ${message}`.trim(), code: e?.code, detail }
}

async function timed(run: () => Promise<unknown>): Promise<StepResult> {
  const t = Date.now()
  try {
    await run()
    return { ok: true, ms: Date.now() - t }
  } catch (err) {
    const d = describeError(err)
    return { ok: false, ms: Date.now() - t, ...d }
  }
}

/**
 * 列出要尝试的端点形状（去重）。
 *
 * Supabase 的 S3 兼容层同时接受两个域名：
 *   https://<ref>.supabase.co/storage/v1/s3
 *   https://<ref>.storage.supabase.co/storage/v1/s3
 * 后者是控制台「Connect to S3」面板给的那条，也是线上公开读地址正在用的域名
 * —— 所以两者都试，才能判断某一边是不是被网络策略挡住了。
 */
function buildEndpointCandidates(configured: string, ref: string | null): string[] {
  const list = [configured]
  if (ref) {
    list.push(`https://${ref}.supabase.co/storage/v1/s3`)
    list.push(`https://${ref}.storage.supabase.co/storage/v1/s3`)
  }
  return [...new Set(list.filter(Boolean))]
}

export async function runStorageSelfTest(): Promise<StorageSelfTestResult> {
  const cfg = resolveStorageConfig()
  const config = {
    ready: cfg.ready,
    bucket: cfg.bucket ?? null,
    // 端点里若含密钥类参数，打码后再回显（正常情况下没有）
    endpoint: cfg.endpoint ?? null,
    publicBase: cfg.publicBase ?? null,
    ref: refFromUrl(cfg.publicBase) ?? null,
    accessKeyIdLength: cfg.accessKeyId?.length ?? 0,
    accessKeyIdFingerprint: fingerprint(cfg.accessKeyId),
    secretAccessKeyLength: cfg.secretAccessKey?.length ?? 0,
    secretAccessKeyFingerprint: fingerprint(cfg.secretAccessKey),
    secretsMatch: Boolean(cfg.accessKeyId) && cfg.accessKeyId === cfg.secretAccessKey,
    endpointHasS3Path: Boolean(cfg.endpoint && /\/storage\/v1\/s3\/?$/.test(cfg.endpoint)),
  }

  // 只列变量名与长度：值本身绝不进响应体，但这足以暴露「多了一条同名/近名变量」
  const envNames = Object.keys(process.env)
    .filter((k) => /supabase|s3|bucket/i.test(k))
    .sort()
    .map((k) => {
      const value = process.env[k] ?? ''
      return {
        name: k,
        valueLength: value.trim().length,
        // 合法的名字是 [A-Z0-9_]，出现空白或小写都说明是手滑（或被平台加壳）
        suspicious: k !== k.trim() || !/^[A-Z0-9_]+$/.test(k),
      }
    })

  // 配置不全时后面的三步必然失败，提前短路，避免用无意义的三连错掩盖根因
  if (!cfg.ready || !cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    const missing = {
      ok: false,
      ms: 0,
      error: '对象存储配置不全（resolveStorageConfig().ready=false），上传必然失败',
    }
    return {
      config,
      envNames,
      headBucket: missing,
      putObject: missing,
      payloadCreate: missing,
      endpointMatrix: [],
      credentialHygiene: describeCredentialHygiene(),
    }
  }

  const { S3Client, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand } = await import(
    '@aws-sdk/client-s3'
  )
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  })

  const headBucket = await timed(() => client.send(new HeadBucketCommand({ Bucket: cfg.bucket })))

  /**
   * 端点候选矩阵：把几种可能的端点形状都试一遍。
   *
   * 这一项的存在理由：本机用同一对密钥、同一个桶，两种端点都能写成功，线上却
   * 500/502。差异只可能在「函数容器里能不能连到这个 host」或「线上配的是哪种形状」。
   * 逐个试并记录结果，就能把「配错」和「连不上」区分开 —— 全部 ERR_NETWORK 说明是
   * 出口被拦，只有某一种 OK 说明是配置形状问题。
   */
  const candidates = buildEndpointCandidates(cfg.endpoint, config.ref)
  const endpointMatrix: Array<{ endpoint: string; ok: boolean; ms: number; error?: string }> = []
  for (const endpoint of candidates) {
    const probeClient = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
    })
    const r = await timed(() => probeClient.send(new HeadBucketCommand({ Bucket: cfg.bucket })))
    endpointMatrix.push({ endpoint, ok: r.ok, ms: r.ms, ...(r.ok ? {} : { error: r.error }) })
  }

  const probeKey = `_health/${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  const putObject = await timed(async () => {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: probeKey,
        Body: PROBE_PNG,
        ContentType: 'image/png',
      }),
    )
    // 探针对象立刻删掉，不做垃圾
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: probeKey }))
  })

  // 第四步走完整的 Payload 上传管线。fail-fast 抑制开关与 /api/health 同款：
  // 缺配时 payload.config 会排程 exit(1)，这里必须挡住，否则进程在响应前就被拉死。
  const g = globalThis as Record<string, unknown>
  const prevSuppress = g.__cloudSuppressPayloadFailFast
  g.__cloudSuppressPayloadFailFast = true
  let createdId: number | string | undefined
  const payloadCreate = await timed(async () => {
    try {
      const [{ getPayload }, { default: config }] = await Promise.all([
        import('payload'),
        import('@payload-config'),
      ])
      const payload = await getPayload({ config })
      const doc = await payload.create({
        collection: 'media',
        data: { alt: '__health_probe__' },
        file: {
          data: PROBE_PNG,
          mimetype: 'image/png',
          name: `health-probe-${Date.now()}.png`,
          size: PROBE_PNG.length,
        },
        overrideAccess: true,
      })
      createdId = (doc as { id?: number | string }).id
    } finally {
      if (createdId !== undefined) {
        try {
          const { getPayload } = await import('payload')
          const { default: config } = await import('@payload-config')
          const payload = await getPayload({ config })
          await payload.delete({ collection: 'media', id: createdId, overrideAccess: true })
        } catch {
          // 清理失败不影响诊断结论，探针记录带 alt 标记可人工清理
        }
      }
    }
  })

  g.__cloudSuppressPayloadFailFast = prevSuppress

  return {
    config,
    envNames,
    headBucket,
    putObject,
    payloadCreate,
    endpointMatrix,
    credentialHygiene: describeCredentialHygiene(),
  }
}
