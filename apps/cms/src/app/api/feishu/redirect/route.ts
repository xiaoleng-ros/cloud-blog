import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * 飞书 OAuth 登录 —— 授权地址
 *
 * 功能：提供两种获取飞书授权的方式
 *   1. 默认（整页跳转）：302 跳转到飞书授权页，用户扫码/确认后飞书回调 /api/feishu/callback
 *   2. ?mode=json（二维码 SDK）：返回给前端内嵌二维码用的 goto 地址
 *
 * 为什么需要两种模式：
 *   飞书授权页在浏览器已存在飞书登录态时会「跳过扫码」，直接显示授权确认页——
 *   对管理员后台而言这是危险的（同浏览器任何人都能一键进入）。
 *   官方 authorization 端点的 prompt 参数只支持 consent（无 login 值），
 *   无法在跳转流程中强制弹出二维码，因此采用官方「二维码 SDK」把二维码嵌到登录页，
 *   每次打开弹窗都由 SDK 生成新二维码，必须手机扫码 + 手机确认才能完成授权。
 *
 * CSRF 防护（P0）：
 *   state 由 crypto 随机生成，同时写入一次性 httpOnly cookie；
 *   回调必须比对 cookie 与飞书回传的 state 并立即清除 cookie。
 *   攻击者无法读取受害者浏览器里的 cookie，也就无法伪造出配对的 state。
 *
 * 环境变量（在 apps/cms/.env 或部署平台配置）：
 *   FEISHU_APP_ID         —— 飞书开发者后台 → 应用凭证 → App ID
 *   FEISHU_REDIRECT_URI   —— 回调地址（必须与飞书应用安全设置里配置的一致）
 *
 * 返回：
 *   302 跳转到飞书授权页（默认模式）
 *   200 { qrAuthUrl }（?mode=json 模式，供二维码 SDK 使用）
 *   400 若 FEISHU_APP_ID / FEISHU_REDIRECT_URI 未配置
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 跳转模式使用的授权端点（2025 年后官方迁移）
 * 旧端点 https://open.feishu.cn/open-apis/authen/v2/authorize 已 404，不再可用
 * 该端点支持自建应用 + 商店应用
 */
const FEISHU_AUTH_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'

/**
 * 二维码 SDK 使用的授权端点（旧版 passport 流程）
 * 官方二维码 SDK 文档明确说明「暂不支持新版登录流程」，goto 必须指向旧版端点；
 * 实测该端点仍可用（302 到 accounts.feishu.cn/accounts/auth_login/oauth2/authorize），
 * 且 MaxKB / DataEase / SQLBot 等开源项目均采用同一写法。
 */
const FEISHU_QR_AUTH_URL = 'https://passport.feishu.cn/suite/passport/oauth/authorize'

/** state cookie 名（回调端共用，见 src/lib/feishu-session.ts） */
const FEISHU_STATE_COOKIE = 'feishu-oauth-state'

/** state 有效期：与二维码提示的 5 分钟一致，留 1 分钟跳转余量 */
const STATE_TTL_SEC = 360

/**
 * 生成防 CSRF 的随机 state
 * ⚠️ 必须用 CSPRNG：Math.random() 可被预测，等于没有防 CSRF。
 */
function createState(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * 构造 state cookie。
 * sameSite=lax：扫码完成后飞书是「顶层跳转」回到回调，lax 允许携带；
 * 而跨站 POST/XHR 不带 cookie，正好挡住 CSRF。
 * @param value 待写入的 state；空串表示清除
 */
function stateCookie(value: string, secure: boolean) {
  return {
    name: FEISHU_STATE_COOKIE,
    value,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: value ? STATE_TTL_SEC : 0,
  }
}

/**
 * 是否应给 cookie 加 Secure（本地 http 开发需要关掉）。
 * 与 callback 路由的 cookieSecure 同口径：以浏览器实际入口 origin 判断
 * （FEISHU_REDIRECT_URI 优先，兜底 request.url）——本地经代理时 request.url
 * 的协议/域名与浏览器地址不一致，两边判断不同会让写入与清除 cookie 的 Secure 标记错位。
 */
function cookieSecure(requestUrl: string): boolean {
  if (process.env.FEISHU_INSECURE_COOKIES === '1') return false
  const redirectUri = process.env.FEISHU_REDIRECT_URI
  try {
    const origin = redirectUri ? new URL(redirectUri).origin : new URL(requestUrl).origin
    return origin.startsWith('https://')
  } catch {
    // 变量格式异常时按 https 处理（同 callback 的兜底倾向：宁可多 Secure 不可少）
    return true
  }
}

/**
 * 按授权端点类型拼装授权 URL
 * @param base 授权端点地址（新版 accounts 端点 或 旧版 passport 端点）
 * @param appId 飞书应用 App ID（v1/passport 端点均使用 client_id 字段名）
 * @param redirectUri 回调地址
 * @param state 防 CSRF 随机串
 * @returns 完整的授权 URL 字符串
 */
function buildAuthUrl(base: string, appId: string, redirectUri: string, state: string): string {
  const url = new URL(base)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('response_type', 'code') // 固定 'code'：授权码流程
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function GET(request: Request) {
  const appId = process.env.FEISHU_APP_ID
  const redirectUri = process.env.FEISHU_REDIRECT_URI

  // 缺失关键环境变量时返回 400，避免用户在飞书端拿到无意义的错误码
  if (!appId || !redirectUri) {
    return NextResponse.json(
      {
        error: 'FEISHU_APP_ID 或 FEISHU_REDIRECT_URI 未配置',
        hint: '请在 apps/cms/.env 里配置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_REDIRECT_URI',
      },
      { status: 400 },
    )
  }

  // 每次请求都生成新的 state，并落一次性 cookie 供回调比对
  const state = createState()
  const secure = cookieSecure(request.url)
  const mode = new URL(request.url).searchParams.get('mode')

  // ── 模式一：二维码 SDK（前端内嵌二维码，强制每次扫码）──
  if (mode === 'json') {
    const qrAuthUrl = buildAuthUrl(FEISHU_QR_AUTH_URL, appId, redirectUri, state)
    const response = NextResponse.json(
      { qrAuthUrl },
      // 禁止缓存：state 必须每次都是新的
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    )
    response.cookies.set(stateCookie(state, secure))
    return response
  }

  // ── 模式二：整页跳转授权（降级路径）──
  // prompt=consent：飞书官方唯一支持的交互值，强制用户显式看到并确认授权页，
  // 避免「已授权过的应用被静默跳过」；注意它无法强制显示二维码（官方限制）。
  const authUrl = new URL(buildAuthUrl(FEISHU_AUTH_URL, appId, redirectUri, state))
  authUrl.searchParams.set('prompt', 'consent')
  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set(stateCookie(state, secure))
  return response
}
