import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * 管理后台访问保护中间件
 *
 * 背景问题：
 *   Payload CMS 的 admin 认证机制是：服务端检测到未登录时，在 RSC（React Server
 *   Components）数据流里写入 NEXT_REDIRECT 指令，由客户端 Flight 读取后发起
 *   client-side navigation（带 RSC:1 header）请求 /admin/login 来渲染登录页。
 *
 *   在 EdgeOne 运行时下，/admin/login 的 RSC 请求会间歇性返回 500（冷启动、
 *   server function 执行不稳定），客户端拿到 500 后无法渲染登录页，页面停在
 *   空 dashboard 壳（title 是「仪表板」但无内容）→ 用户看到白屏。
 *
 * 规避方案：
 *   在 middleware 层，对未登录用户访问 /admin（根管理页）时直接返回真正的 HTTP 307
 *   到 /admin/login。浏览器收到 HTTP 307 后发起整页加载（普通 GET，稳定 200），
 *   不再依赖 RSC client-side navigation，从而绕开 EdgeOne 上 RSC 间歇性 500。
 *
 * 命中范围：
 *   匹配 /admin 前缀（管理入口及其子页面），但登录页本身放行（避免重定向死循环）：
 *   - /admin/login            登录页本身 → 放行
 *   - /admin/...              其余后台页：无有效 token → HTTP 307 到 /admin/login
 *   Payload REST API 挂在 /api（见 payload.config 的 routes.api，默认 '/api'），
 *   不在 /admin 前缀下，故不受本中间件影响；/_next/* 静态资源同理不命中。
 *   注：对已登录（token 结构合法）的子页面一律放行，交由 Payload 自身鉴权；
 *   与旧版「仅精确匹配 /admin」相比，这里放宽到 /admin 前缀，让未登录深链也直接走
 *   稳定的整页 307，而不是依赖 EdgeOne 上间歇性 500 的 RSC 重定向。
 *
 * 鉴权判断：
 *   检查 payload-token cookie 是否存在。cookie 不存在 = 未登录，直接 307。
 *   cookie 存在但过期/无效时放行，由 Payload 自身的 RootPage 处理（此时走
 *   RSC redirect，属于边缘场景，不影响主要访问流程）。
 *
 *   额外做一层「JWT 结构校验」（三段 base64url、payload 可解析为 JSON）：
 *   若 token 明显损坏或不是 JWT，直接视为未登录 307 到登录页，避免下游 RSC
 *   尝试解析无效 payload 时又走进 EdgeOne 上间歇性 500 的路径。不做签名验证
 *   （那需要 PAYLOAD_SECRET，也不适合放在 middleware 里），签名校验继续交给
 *   Payload RootPage。
 */

/**
 * 判断字符串是否符合 JWT 基础结构：
 *   - 恰好 3 段（header.payload.signature），用 '.' 分隔
 *   - header / payload 段是合法 base64url（长度符合、无非法字符）
 *   - payload 段能 base64 解码并解析为 JSON 对象
 *
 * 说明：只做「结构校验」，不做签名验证（签名需要 PAYLOAD_SECRET，不适合放在
 * middleware 里）。目的是拦「明显不是 JWT 的垃圾 token」，避免下游 RSC 尝试
 * 解析无效 payload 时又走进 EdgeOne 上 RSC 间歇性 500 的路径。
 *
 * @param token - 从 cookie 取出的原始字符串
 * @returns 结构合法返回 true，否则 false
 */
function isValidJwtShape(token: string): boolean {
  // 三段结构
  const parts = token.split('.')
  if (parts.length !== 3) return false

  // base64url 合法字符集：字母、数字、-、_
  const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
  const toBase64 = (seg: string): string => {
    // 长度需为 4 的倍数（base64url 允许去掉尾部 =，故补回）
    const padded = seg.padEnd(seg.length + ((4 - (seg.length % 4)) % 4), '=')
    return padded.replace(/-/g, '+').replace(/_/g, '/')
  }

  // header / payload 段必须合法
  for (let i = 0; i < 2; i++) {
    if (!parts[i] || !BASE64URL_RE.test(parts[i])) return false
    try {
      globalThis.atob(toBase64(parts[i]))
    } catch {
      return false
    }
  }

  // payload 段解码后必须是 JSON 对象
  try {
    // atob 返回的字符串可能是高位字节（UTF-8 编码结果），通过 charCodeAt + TextDecoder
    // 还原成正确的 UTF-8 文本，避免中文场景下 JSON.parse 失败
    const decodedChars = globalThis.atob(toBase64(parts[1]))
    const bytes = new Uint8Array(decodedChars.length)
    for (let i = 0; i < bytes.length; i++) bytes[i] = decodedChars.charCodeAt(i)
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

/**
 * 后台鉴权相关常量（与 payload.config 的对应关系，务必同步维护）：
 * - COOKIE_NAME   = `${cookiePrefix}-token`：Payload 3.x 默认 cookiePrefix 为 'payload'
 *                   （payload.config 未覆盖 routes/cookiePrefix），故登录令牌名为 'payload-token'。
 * - ADMIN_ROOT    = payload.config 的 routes.admin：本仓库未显式配置，取 Payload 默认 '/admin'。
 * - ADMIN_LOGIN_PATH = ADMIN_ROOT + '/login'，登录页本身（放行，避免 307 死循环）。
 * 若将来在 payload.config 修改 cookiePrefix 或 routes.admin，需同步这三处常量。
 */
const COOKIE_NAME = 'payload-token'
const ADMIN_ROOT = '/admin'
const ADMIN_LOGIN_PATH = `${ADMIN_ROOT}/login`

/** pathname 是否落在 prefix 之下（prefix 本身或 `${prefix}/` 前缀） */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 处理 /admin 前缀（管理入口及其子页面）
  if (isUnder(pathname, ADMIN_ROOT)) {
    // 登录页本身放行，避免重定向死循环
    if (isUnder(pathname, ADMIN_LOGIN_PATH)) {
      return NextResponse.next()
    }

    // Payload 3.x 默认 cookie 名为 payload-token（cookiePrefix 默认 'payload'）
    const token = request.cookies.get(COOKIE_NAME)?.value

    // 未登录（无 token）或 token 结构明显损坏 → HTTP 307 到登录页
    if (!token || !isValidJwtShape(token)) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = ADMIN_LOGIN_PATH
      return NextResponse.redirect(loginUrl, 307)
    }
  }

  return NextResponse.next()
}

// runtime 策略：middleware 逻辑极简（仅读 cookie + redirect，不依赖任何 Node API），
// 使用 Next.js 默认的 Edge runtime 即可，无需 experimental flag，构建稳定。
// 注：EdgeOne Makers 作为 Next.js 托管平台支持 Edge runtime middleware。

// 匹配 /admin 前缀（含 /admin 本身与其下所有子路径），鉴权判断见上方 isUnder 逻辑
export const config = {
  matcher: '/admin/:path*',
}
