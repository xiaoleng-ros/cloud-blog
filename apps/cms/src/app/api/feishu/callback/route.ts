import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { createLocalReq, getPayload } from 'payload'
import config from '@payload-config'
import { readCookie } from '../../../../lib/feishu-session'

/**
 * 飞书 OAuth 登录 —— 回调处理
 *
 * 完整流程：
 *   1. 校验飞书回传的 state 与下发的一次性 cookie 配对（防 CSRF）
 *   2. 从飞书回调拿到 authorization code
 *   3. 用 code + app_secret 向飞书换 access_token
 *   4. 用 access_token 拉取用户基本信息（open_id / union_id / name / avatar）
 *   5. 在 Payload Users 表里按 feishu.openId 找到绑定的账号
 *   6. 给用户写入一条 session（sid），再签一个带 sid 的 JWT
 *   7. 写入 payload-token cookie → 302 到 /admin
 *
 * 环境变量：
 *   FEISHU_APP_ID         —— 飞书应用 App ID
 *   FEISHU_APP_SECRET     —— 飞书应用 App Secret（保密）
 *   FEISHU_REDIRECT_URI   —— 回调地址（必须与飞书应用安全设置一致）
 *
 * 安全说明：
 *   - app_secret 只用于服务端换 token，绝不返回给前端
 *   - state 必须与 /api/feishu/redirect 落下的一次性 httpOnly cookie 完全一致，比对后立即清除
 *   - 不再做「首次扫码自动绑定到 FEISHU_ADMIN_EMAIL」：未绑定账号必须先以密码登录后台，
 *     再访问 /api/feishu/bind 主动认领自己的 open_id（否则任何飞书用户扫码即可劫持管理员账号）
 *   - 不做「新账号自动创建」，避免飞书任意用户扫码就能成为管理员
 *   - 会话写入 Users.sessions（auth.useSessions: true），因此管理员可在后台删除会话 / 改密后立即吊销
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 飞书 OAuth Token 端点（2025 年后官方迁移）
 * 旧 v2 端点已不推荐，v3 修正了 PKCE 校验语义并统一到 accounts.feishu.cn 域名
 * 请求体字段（client_id / client_secret / code / redirect_uri）与 v2 一致
 */
const FEISHU_TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token'
const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info'

// JWT 默认过期时长：24h（原为 7 天；配合可吊销会话进一步压缩存活期）
const DEFAULT_TOKEN_EXPIRATION_SEC = 60 * 60 * 24

/** state cookie 名（与 /api/feishu/redirect 保持一致） */
const FEISHU_STATE_COOKIE = 'feishu-oauth-state'

/**
 * 飞书 OAuth 授权状态码（v1 端点，accounts.feishu.cn）
 * 参考飞书官方文档 https://open.feishu.cn/document/server-docs/authentication-management/authen-overview
 * 注意：v1 端点错误码体系与 open.feishu.cn/v2 端点不同，不要混用
 */
const FEISHU_ERROR = {
  /** 授权码有效 —— 第一次回调成功 */
  OK: 0,
  /** 授权码格式非法 —— 请求参数写错 */
  INVALID_CODE: 10003,
  /** 授权码已被消耗 —— 同一 code 第二次请求，说明第一次已经成功处理过 */
  CODE_USED: 10004,
  /** 授权码无效（过期 / 状态失效） */
  INVALID_OR_EXPIRED: 10005,
  /** 请求过于频繁 */
  TOO_FREQUENT: 10006,
  /** 用户拒绝授权或取消流程 */
  USER_DENIED: 10009,
  /** 应用没有授权该 redirect_uri */
  INVALID_REDIRECT_URI: 10016,
} as const

// 已成功兑换过 token 的 code 集合（防重放用）
// 重放原因：浏览器/代理可能自动重发 307 响应所携带的原始 URL，
//           飞书端 code 是一次性的，第二次会被判"已使用"而报 10004
// 用途：第二次请求直接跳 /admin，避免把用户踢回登录页（第一次已成功登录）
// 注：这是 dev 便利措施。生产环境 Next.js standalone 是单进程，同样安全；
//     后续若扩展为多实例部署，可改用 Payload KV 存储做分布式缓存
const consumedCodes = new Map<string, number>()
const CONSUMED_CODE_TTL_SEC = 300 // 缓存 5 分钟（code 有效期约 10 分钟，覆盖足够）

/**
 * 判断 code 是否已成功兑换过
 * @param code 飞书授权码
 * @returns 是否命中缓存
 */
function isCodeConsumed(code: string): boolean {
  const at = consumedCodes.get(code)
  if (!at) return false
  if (Date.now() - at > CONSUMED_CODE_TTL_SEC * 1000) {
    consumedCodes.delete(code)
    return false
  }
  return true
}

/** 标记 code 已兑换（用于防重放） */
function markCodeConsumed(code: string) {
  // 顺便清理过期条目，防止 Map 无限增长
  if (consumedCodes.size > 200) {
    for (const [k, t] of consumedCodes) {
      if (Date.now() - t > CONSUMED_CODE_TTL_SEC * 1000) consumedCodes.delete(k)
    }
  }
  consumedCodes.set(code, Date.now())
}

/**
 * 获取浏览器实际访问的 origin（代理地址，而非 CMS 直连地址）
 * 代理场景下 request.url 是 localhost:9527（CMS 直连），但浏览器入口是 127.0.0.1:4321（代理）
 * 若用 request.url 构造跳转 URL，cookie（绑定 127.0.0.1）和跳转目标（localhost:9527）会跨域
 * cookie 不会被发送 → Payload 判定未登录 → 踢回登录页
 * 从 FEISHU_REDIRECT_URI 提取 origin 可确保跳转回到代理地址
 * @param requestUrl Route Handler 的 request.url（兜底用）
 * @returns 浏览器实际访问的 origin，如 http://127.0.0.1:4321
 */
function getBrowserOrigin(requestUrl: string): string {
  const redirectUri = process.env.FEISHU_REDIRECT_URI
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin
    } catch {
      // FALLTHROUGH: 环境变量格式异常时兜底用 request.url
    }
  }
  return new URL(requestUrl).origin
}

/** 会话/令牌 cookie 是否加 Secure：浏览器入口是 https 就加；本地 http 开发可用变量关闭 */
function cookieSecure(requestUrl: string): boolean {
  if (process.env.FEISHU_INSECURE_COOKIES === '1') return false
  return getBrowserOrigin(requestUrl).startsWith('https://')
}

/**
 * 构造重定向响应，附带防缓存头
 * @param url 目标 URL（绝对路径）
 * @returns NextResponse.redirect 响应
 */
function redirectNoStore(url: string) {
  const resp = NextResponse.redirect(url.toString())
  // 禁止浏览器缓存 307 响应，防止后续重放再次消耗 code
  resp.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  resp.headers.set('Pragma', 'no-cache')
  return resp
}

/**
 * 构造跳转到 /admin 的成功响应（用代理地址，确保 cookie 跨域一致）
 * @param requestUrl Route Handler 的 request.url
 * @returns NextResponse.redirect 响应（307，带 no-store 头）
 */
function redirectToAdmin(requestUrl: string) {
  const target = `${getBrowserOrigin(requestUrl)}/admin`
  console.log(`[feishu/callback] 跳转到后台: ${target}`)
  return redirectNoStore(target)
}

/**
 * 构造跳转到 /admin/login 的错误响应（用代理地址）
 * @param requestUrl Route Handler 的 request.url
 * @param error 错误码（作为 query 参数）
 * @param hint 错误提示（作为 query 参数）
 * @returns NextResponse.redirect 响应（307，带 no-store 头）
 */
function redirectToLogin(requestUrl: string, error: string, hint?: string) {
  const target = new URL('/admin/login', getBrowserOrigin(requestUrl))
  target.searchParams.set('feishu_error', error)
  if (hint) target.searchParams.set('feishu_hint', hint)
  return redirectNoStore(target.toString())
}

/**
 * 飞书 v3 token 响应结构（扁平化，无 data 包裹）
 * 与 v2 的区别：
 *   v2: { code, msg, data: { access_token, token_type, ... } }
 *   v3: { code, access_token, token_type, expires_in, ... }
 * 失败时字段为 error / error_description（而非 msg）
 */
type FeishuTokenResponse = {
  code: number
  // 成功字段
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  token_type?: string
  scope?: string
  // 失败字段
  msg?: string
  error?: string
  error_description?: string
}

type FeishuUserInfoResponse = {
  code: number
  msg: string
  data?: {
    open_id?: string
    union_id?: string
    user_id?: string
    name?: string
    email?: string
    mobile?: string
    avatar?: {
      avatar_240?: string
      avatar_72?: string
      avatar_640?: string
      avatar_origin?: string
    }
    tenant_key?: string
  }
}

// getPayload 实例进程内缓存（跟 blog-sync.ts 相同策略，避免每请求重建）
type PayloadDb = Awaited<ReturnType<typeof getPayload>>
let dbPromise: Promise<PayloadDb> | null = null

function getDb(): Promise<PayloadDb> {
  if (!dbPromise) {
    dbPromise = getPayload({ config }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

/** 用 authorization code 换 access_token；失败抛错 */
async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
): Promise<{ accessToken: string; tokenType: string }> {
  const resp = await fetch(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const body = (await resp.json()) as FeishuTokenResponse
  // v3 响应是扁平结构：access_token 直接在顶层
  if (body.code !== 0 || !body.access_token) {
    // 失败时优先读 error_description，兜底 msg（兼容极个别返回）
    const reason = body.error_description ?? body.msg ?? body.error ?? `code=${body.code}`
    throw new Error(`[feishu] token exchange failed: ${reason}`)
  }
  return { accessToken: body.access_token, tokenType: body.token_type ?? 'Bearer' }
}

/**
 * 拉取飞书当前用户信息
 *
 * ⚠️ 官方要求用 GET 方法（POST 会返回纯文本 "Not Found"）
 * URL: GET https://open.feishu.cn/open-apis/authen/v1/user_info
 * Header: Authorization: Bearer <user_access_token>
 */
async function fetchFeishuUserInfo(accessToken: string): Promise<{
  openId: string
  unionId?: string
  name?: string
  avatar?: string
}> {
  const resp = await fetch(FEISHU_USER_INFO_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  // 防御：飞书出错时可能返回非 JSON（如 "Not Found"），先读文本再判断
  const rawText = await resp.text()
  let body: FeishuUserInfoResponse
  try {
    body = JSON.parse(rawText) as FeishuUserInfoResponse
  } catch {
    throw new Error(
      `[feishu] user info 返回非 JSON（HTTP ${resp.status}）：${rawText.slice(0, 200)}`,
    )
  }

  if (body.code !== 0 || !body.data?.open_id) {
    throw new Error(`[feishu] user info failed: code=${body.code} msg=${body.msg}`)
  }
  return {
    openId: body.data.open_id,
    unionId: body.data.union_id,
    name: body.data.name,
    avatar: body.data.avatar?.avatar_240 ?? body.data.avatar?.avatar_72,
  }
}

/**
 * 给用户建立一条 Payload 会话并签发配套 JWT。
 *
 * ⚠️ 不能用 payload.login()：本地 API 的 login 会走 local strategy，强制要求 password
 * （见 payload/dist/auth/operations/login.js 的 password 校验），飞书扫码没有密码。
 * 因此这里复刻 Payload 的 addSessionToUser + jwtSign：
 *   - 会话写入 user.sessions，字段结构与 Payload 内部一致
 *   - JWT 载荷带 sid，Payload 的 jwt strategy 会在 useSessions: true 时校验 sid 是否存在
 *     （见 payload/dist/auth/strategies/jwt.js）
 * 代价是保留了 sessions 能力：后台删会话 / 改密码都能立即吊销这个令牌。
 */
async function createUserSession(
  payload: PayloadDb,
  userDoc: { id: string | number; email?: string },
  tokenExpirationSec: number,
): Promise<{ token: string; expiresAt: Date }> {
  const collectionConfig = payload.collections.users.config
  const sid = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + tokenExpirationSec * 1000)

  const current = await payload.findByID({
    collection: 'users',
    id: userDoc.id,
    depth: 0,
  })
  const existing = ((current as { sessions?: Array<{ id: string; expiresAt: string | Date }> })
    ?.sessions ?? []) as Array<{ id: string; expiresAt: string | Date }>
  const liveSessions = existing.filter((s) => new Date(s.expiresAt) > now)

  // updatedAt 置 null：仅新增会话不应改动「更新时间」（与 Payload addSessionToUser 行为一致）
  await payload.db.updateOne({
    id: userDoc.id,
    collection: 'users',
    data: {
      sessions: [...liveSessions, { id: sid, createdAt: now, expiresAt }],
      updatedAt: null,
    },
    req: await createLocalReq({}, payload),
    returning: false,
  })

  const fieldsToSign = {
    id: userDoc.id,
    collection: collectionConfig.slug,
    email: userDoc.email ?? '',
    sid,
  }

  // ⚠️ jose 的 setExpirationTime 传「数字」时按 Unix 时间戳（秒）的绝对时刻解释，
  // 而不是「从现在起多少秒」。必须显式换算成绝对时间戳：
  // 若直接传 tokenExpirationSec（如 86400 = 1天的秒数），exp 会落在 1970-01-02，
  // token 一签发即过期 → jwtVerify 抛 JWTExpired → Payload 判定未登录 → 踢回登录页。
  const issuedAt = Math.floor(Date.now() / 1000)
  const secretKey = new TextEncoder().encode(payload.secret)
  const token = await new SignJWT(fieldsToSign)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + tokenExpirationSec)
    .sign(secretKey)

  return { token, expiresAt }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  // 诊断日志：只打印是否存在 code / state，不打印原值
  // （authorization code 是短期凭据，state 泄露到采集日志可被复用）
  console.log(
    `[feishu/callback] 收到回调 code=${url.searchParams.get('code') ? '(有)' : '(无)'} ` +
      `error=${url.searchParams.get('error') ?? '(无)'} ` +
      `state=${url.searchParams.get('state') ? '(有)' : '(无)'}`,
  )

  // state cookie 无论走到哪个分支都要清除，避免同一个 state 被反复使用
  const clearStateCookie = (resp: NextResponse, secure: boolean) => {
    resp.cookies.set({
      name: FEISHU_STATE_COOKIE,
      value: '',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return resp
  }

  const secure = cookieSecure(request.url)

  try {
    // 1. 校验 state：必须与 /api/feishu/redirect 落下的一次性 cookie 完全一致
    const state = url.searchParams.get('state')
    const cookieState = readCookie(request, FEISHU_STATE_COOKIE)
    if (!state || !cookieState || state !== cookieState) {
      console.warn('[feishu/callback] state 缺失或与 cookie 不匹配，拒绝登录（疑似 CSRF / 流程过期）')
      return clearStateCookie(redirectToLogin(request.url, 'invalid_state'), secure)
    }

    // 2. 读取飞书带回的 code；错误场景直接跳登录页并带上错误信息
    const code = url.searchParams.get('code')
    if (!code) {
      const error = url.searchParams.get('error') ?? 'missing_code'
      return clearStateCookie(redirectToLogin(request.url, error), secure)
    }

    // 2.5 防重放：若该 code 已成功兑换过（浏览器/代理重放了同 URL 请求），
    //     直接跳 /admin，不再消耗一次无效的 code。
    //     原因：飞书 code 一次性，第一次兑换后会话 cookie 已建立；
    //           第二次请求重放会触发 10004 "code has been used" 错误，
    //           错误路径会 302 回登录页，覆盖第一次成功登录的状态。
    if (isCodeConsumed(code)) {
      console.log('[feishu/callback] code 已消耗，判定为重放请求，直接跳 /admin')
      return clearStateCookie(redirectToAdmin(request.url), secure)
    }

    // 3. 校验必需环境变量
    const appId = process.env.FEISHU_APP_ID
    const appSecret = process.env.FEISHU_APP_SECRET
    const redirectUri = process.env.FEISHU_REDIRECT_URI
    if (!appId || !appSecret || !redirectUri) {
      return clearStateCookie(
        NextResponse.json(
          { error: '飞书应用凭证未配置', hint: 'FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REDIRECT_URI' },
          { status: 500 },
        ),
        secure,
      )
    }

    // 4. 用 code 换 access_token
    let accessToken: string
    try {
      const result = await exchangeCodeForToken(code, appId, appSecret, redirectUri)
      accessToken = result.accessToken
    } catch (err) {
      // 若飞书返回 10004（code 已被消耗），说明此前已成功登录过，视为成功跳转
      const msg = (err as Error).message
      if (msg.includes('has been used') || msg.includes(String(FEISHU_ERROR.CODE_USED))) {
        console.log('[feishu/callback] 飞书返回 10004，判定为重放，跳 /admin')
        return clearStateCookie(redirectToAdmin(request.url), secure)
      }
      throw err
    }

    // 4.5 标记该 code 已消耗，后续重放直接跳 /admin
    markCodeConsumed(code)

    // 5. 拉取用户信息
    const feishuUser = await fetchFeishuUserInfo(accessToken)

    // 6. 初始化 Payload 实例
    const payload = await getDb()

    // 7. 找已绑定的账号：只按 feishu.openId 匹配。
    //    未绑定一律拒绝 —— 认领 open_id 必须在已登录状态下访问 /api/feishu/bind 完成。
    const { docs } = await payload.find({
      collection: 'users',
      where: { 'feishu.openId': { equals: feishuUser.openId } },
      limit: 1,
      pagination: false,
    })
    const userDoc = docs[0] ?? null

    if (!userDoc) {
      console.log('[feishu/callback] 该飞书账号未绑定任何管理员，拒绝登录')
      return clearStateCookie(
        redirectToLogin(
          request.url,
          'not_bound',
          '此飞书账号尚未绑定。请先用密码登录后台，再访问 /api/feishu/bind 完成绑定。',
        ),
        secure,
      )
    }

    // 8. 建立会话并签发带 sid 的 JWT（可被后台吊销）
    const configuredExpiration = (payload.config as { admin?: { cookieExpiration?: number } }).admin
      ?.cookieExpiration
    const tokenExpiration =
      typeof configuredExpiration === 'number' && configuredExpiration > 0
        ? Math.min(configuredExpiration, DEFAULT_TOKEN_EXPIRATION_SEC)
        : DEFAULT_TOKEN_EXPIRATION_SEC
    const { token, expiresAt } = await createUserSession(
      payload,
      { id: userDoc.id, email: userDoc.email },
      tokenExpiration,
    )

    // 9. 写 cookie 并跳转
    //     cookie 名使用 payload.config.cookiePrefix + '-token'，与 Payload 内部 extractJWT 一致
    const cookiePrefix = (payload.config as { cookiePrefix?: string }).cookiePrefix ?? 'payload'
    const cookieName = `${cookiePrefix}-token`

    // ⚠️ 跳转地址必须用浏览器实际访问的 origin（代理地址），而非 request.url（CMS 直连地址）
    // 代理场景：浏览器入口 127.0.0.1:4321 → proxy → CMS localhost:9527
    // 若用 request.url 构造跳转，Location 会是 localhost:9527/admin，
    // 但 cookie 绑定在 127.0.0.1 域 → 跨域 cookie 丢失 → Payload 判定未登录 → 踢回登录页
    const successUrl = new URL('/admin', getBrowserOrigin(request.url))
    const response = NextResponse.redirect(successUrl.toString())
    // 禁止浏览器缓存，防止重放再次消耗 code（与下方 sameSite 解析块共用同一 response 对象）
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.headers.set('Pragma', 'no-cache')

    // 从 payload.collections 里取用户集合的 auth 配置，读取 cookies 参数（secure/sameSite/domain）
    const authConfig = payload.collections.users?.config.auth as {
      tokenExpiration?: number
      useSessions?: boolean
      cookies?: {
        domain?: string
        secure?: boolean
        // Payload 类型定义为 SameSiteOptions | false，这里收敛成 string | boolean 便于读取
        sameSite?: string | boolean
      }
    } | undefined

    // sameSite 解析：对齐 Payload 内部 generatePayloadCookie 的行为
    // - 若配置为字符串（'strict' | 'lax' | 'none' 或大写形式）统一转成小写（Next.js ResponseCookie 规范）
    // - 若为 boolean true 视为 strict（Payload 行为）
    // - 若为 false 或未配置，兜底 'lax'（飞书回调场景必需，strict 会阻止跨站跳转带 cookie）
    const sameSite = (() => {
      const raw = authConfig?.cookies?.sameSite
      if (typeof raw === 'string') return raw.toLowerCase() as 'strict' | 'lax' | 'none'
      if (raw === true) return 'strict' as const
      return 'lax' as const
    })()

    response.cookies.set(cookieName, token, {
      path: '/',
      httpOnly: true,
      // 不再无条件 false：https 入口下必须 Secure，否则会话令牌可被明文窃取
      secure,
      sameSite,
      domain: authConfig?.cookies?.domain,
      expires: expiresAt,
    })
    clearStateCookie(response, secure)

    return response
  } catch (err) {
    console.error('[feishu/callback] error:', err)
    // 对外只给错误编号，不回显原始异常信息（可能含连接串 / 堆栈）
    return clearStateCookie(redirectToLogin(request.url, 'server_error'), secure)
  }
}
