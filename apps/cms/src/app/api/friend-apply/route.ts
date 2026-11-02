import { NextResponse } from 'next/server'
import { isSameOriginRequest } from '../../../lib/same-origin'
import { clientIp } from '../../../lib/client-ip'
import { getDb } from '../../../lib/blog-sync'

/**
 * 友链申请（公开接口）
 *
 * ⚠️ 现状（2026-11-02）：前台**已移除申请表单**，友链页只提供「评论区留言」与
 * 「发邮件」两种方式。这条接口暂时没有页面入口，保留为备用通道 ——
 * 若将来想恢复站内表单，前端 POST 到这里即可，服务端逻辑与限流不用重写。
 *
 * ==================== 为什么不用 Payload 内置 REST ====================
 *
 * 内置 `POST /api/friends` 的 create access 只给登录用户（见 collections/Friends.ts）。
 * 如果为了「让访客能提交」而放开匿名 create，任何人都能直接写 `status: 'published'`
 * 把自己塞进前台 —— 审核环节等于不存在。所以访客通道单独开一条：
 * 服务端固定 status='pending' / source='apply'，客户端提交的任何 status 都被忽略。
 *
 * ==================== 跨域与同源 ====================
 *
 * 生产是前后台同域（EdgeOne 一体化部署），走严格同源校验。
 * 但本地开发是「前台 3000 → 后台 9527」两个端口，浏览器会判跨站并先发 OPTIONS 预检。
 * 因此这里：
 *   - dev（NODE_ENV !== production）放行 localhost / 127.0.0.1 的任意端口；
 *   - 生产只认同源，外加显式白名单 FRIEND_APPLY_ALLOWED_ORIGINS（逗号分隔，用于
 *     将来前台独立部署到别的域名时放开）；
 *   - 允许的来源才回 Access-Control-Allow-Origin，绝不回 `*`（否则任何人都能带 cookie 提交）。
 *
 * ==================== 其它防护 ====================
 *
 * 1. 双段限流（按 IP）：短窗 10 分钟 3 次防连点，长窗 24 小时 8 次防刷。
 *    ⚠️ 计数器在模块作用域内，云函数多实例时各自独立 —— 它不是精确配额，
 *    只是抬高滥用成本；真正的兜底是「必须人工审核才会出现在前台」。
 * 2. 蜜罐字段 `website`：真实用户看不见，机器人会填。命中后直接返回成功但不落库，
 *    不给对方任何「被识别」的反馈。
 * 3. 去重：同 URL 已在库中（任何状态）→ 409，顺带告诉申请人「已在列表或审核中」。
 * 4. 长度上限全覆盖，避免一条记录把库撑爆。
 *
 * 契约：
 *   POST /api/friend-apply
 *   body: { name, url, description?, avatar?, email?, message?, website? }
 *   200 { ok: true } | 400 { error } | 409 { error } | 429 { error } | 403
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SHORT_WINDOW_MS = 10 * 60 * 1000
const SHORT_LIMIT = 3
const LONG_WINDOW_MS = 24 * 60 * 60 * 1000
const LONG_LIMIT = 8

/** IP → 时间戳队列（只保留窗口内的记录，超窗自动滑出） */
const hits = new Map<string, number[]>()

/** 定期清理过期键，避免长驻实例里 Map 无限增长 */
function sweep(now: number) {
  if (hits.size < 500) return
  for (const [ip, list] of hits) {
    const alive = list.filter((t) => now - t < LONG_WINDOW_MS)
    if (alive.length === 0) hits.delete(ip)
    else hits.set(ip, alive)
  }
}

/** 显式放行的来源（生产用；本地开发另有回环放行规则） */
function extraOrigins(): string[] {
  return (process.env.FRIEND_APPLY_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 本机回环地址（dev 下前台后台端口不同，必须放行） */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1'
  } catch {
    return false
  }
}

/**
 * 该请求的来源是否可信。
 * 无 Origin（curl / 非浏览器）时退回 isSameOriginRequest 的 Sec-Fetch-Site 判定。
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return isSameOriginRequest(request)

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return true
  } catch {
    return false
  }
  if (extraOrigins().includes(origin)) return true
  if (process.env.NODE_ENV !== 'production' && isLoopbackOrigin(origin)) return true
  return false
}

/** 允许的来源才回 CORS 头；用具体 origin（不是 *），并允许 credentials 以便将来带会话 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin || !originAllowed(request)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

const reply = (request: Request, body: unknown, status: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...corsHeaders(request) },
  })

/**
 * 记一次提交并判定是否超限。
 * 返回 null 表示放行；返回字符串表示拒绝原因。
 */
function rateLimit(ip: string): string | null {
  if (!ip) return null // 拿不到可信 IP（本地/内网调试）时不限流，与全站口径一致
  const now = Date.now()
  sweep(now)
  const list = (hits.get(ip) ?? []).filter((t) => now - t < LONG_WINDOW_MS)
  const inShort = list.filter((t) => now - t < SHORT_WINDOW_MS).length
  if (inShort >= SHORT_LIMIT) return '提交太频繁了，请 10 分钟后再试'
  if (list.length >= LONG_LIMIT) return '今天提交的次数有点多，明天再来吧'
  list.push(now)
  hits.set(ip, list)
  return null
}

/** 去空白 + 长度限制（超长直接拒绝比静默截断更可信） */
const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > max) return null
  return trimmed
}

/** 站点地址归一化：去掉末尾斜杠（https://a.com/ 与 https://a.com 视为同一个站） */
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // 丢掉 hash：同一页面不同锚点不算新站
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.origin}${path}${u.search}`
  } catch {
    return null
  }
}

/** CORS 预检（本地 dev 跨端口必需；生产同域时浏览器不会发） */
export async function OPTIONS(request: Request) {
  if (!originAllowed(request)) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request: Request) {
  // 1. 来源校验：跨站直接拒
  if (!originAllowed(request)) return reply(request, { error: '请求来源不合法' }, 403)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return reply(request, { error: '请求格式不正确' }, 400)
  }

  // 2. 蜜罐：填了就当垃圾请求，静默成功（不落库）
  const honeypot = typeof body.website === 'string' ? body.website.trim() : ''
  if (honeypot) return reply(request, { ok: true }, 200)

  // 3. 字段校验
  const name = text(body.name, 50)
  if (!name) return reply(request, { error: '请填写站点名称（50 字以内）' }, 400)

  const rawUrl = text(body.url, 200)
  if (!rawUrl) return reply(request, { error: '请填写站点地址（200 字符以内）' }, 400)
  const url = normalizeUrl(rawUrl)
  if (!url) return reply(request, { error: '站点地址必须是 http(s) 开头的完整地址' }, 400)

  const description = text(body.description, 120) ?? ''
  const avatarRaw = text(body.avatar, 300) ?? ''
  const message = text(body.message, 300) ?? ''
  const email = text(body.email, 120) ?? ''

  // 头像可留空；填了就必须是 http(s)（前台 <img src> 直接用它）
  let avatar = ''
  if (avatarRaw) {
    if (!normalizeUrl(avatarRaw)) return reply(request, { error: '头像必须是 http(s) 开头的图片地址' }, 400)
    avatar = avatarRaw
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(request, { error: '邮箱格式不正确' }, 400)
  }

  // 4. 限流
  const ip = clientIp(request)
  const limited = rateLimit(ip)
  if (limited) return reply(request, { error: limited }, 429)

  // 5. 写入（overrideAccess：集合本身不允许匿名 create，这里由服务端受控写入）
  try {
    const payload = await getDb()

    // 去重：任何状态的同 URL 都算已存在。库里历史数据可能带尾斜杠，两种形态都查
    const existing = await payload.find({
      collection: 'friends',
      where: { or: [{ url: { equals: url } }, { url: { equals: `${url}/` } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.totalDocs > 0) {
      return reply(request, { error: '这个站点已经在友链里，或正在审核中' }, 409)
    }

    await payload.create({
      collection: 'friends',
      data: {
        name,
        url,
        description,
        avatar,
        email,
        message,
        // 以下四项不接受客户端输入：状态与来源由服务端决定，IP 用于排查
        status: 'pending',
        source: 'apply',
        submitIp: ip,
        group: '朋友们',
      },
      overrideAccess: true,
    })

    return reply(request, { ok: true }, 200)
  } catch (err) {
    // 唯一索引冲突（并发下两个请求同时通过上面的去重检查）也按「已存在」回
    const message = String((err as Error)?.message ?? '')
    if (/duplicate key|unique constraint/i.test(message)) {
      return reply(request, { error: '这个站点已经在友链里，或正在审核中' }, 409)
    }
    // 原始错误只进服务端日志：本接口匿名可访问，不能回显连接串/SQL
    console.error('[friend-apply] 写入失败:', err)
    return reply(request, { error: '提交失败，请稍后再试' }, 500)
  }
}

/** 其它方法一律 405（避免被当成可探测端点） */
export async function GET(request: Request) {
  return reply(request, { error: '请使用 POST 提交友链申请' }, 405)
}
