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
 *   仅精确匹配 /admin（根路径），不影响：
 *   - /admin/login            登录页本身
 *   - /admin/_next/...        admin 静态资源（JS/CSS chunk）
 *   - /admin/collections/...  已登录后的子页面
 *   - /admin/api/...          Payload REST API
 *
 * 鉴权判断：
 *   检查 payload-token cookie 是否存在。cookie 不存在 = 未登录，直接 307。
 *   cookie 存在但过期/无效时放行，由 Payload 自身的 RootPage 处理（此时走
 *   RSC redirect，属于边缘场景，不影响主要访问流程）。
 *
 * @param request - Next.js 请求对象（含 cookies、nextUrl）
 * @returns NextResponse.redirect（未登录跳转）或 NextResponse.next（放行）
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 仅处理精确的 /admin（不带尾随斜杠、不带子路径）
  if (pathname === '/admin') {
    // Payload 3.x 默认 cookie 名为 payload-token（cookiePrefix 默认 'payload'）
    const token = request.cookies.get('payload-token')?.value

    // 未登录（无 payload-token cookie）→ HTTP 307 到登录页
    if (!token) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      return NextResponse.redirect(loginUrl, 307)
    }
  }

  return NextResponse.next()
}

// runtime 策略：middleware 逻辑极简（仅读 cookie + redirect，不依赖任何 Node API），
// 使用 Next.js 默认的 Edge runtime 即可，无需 experimental flag，构建稳定。
// 注：EdgeOne Makers 作为 Next.js 托管平台支持 Edge runtime middleware。

// 精确匹配 /admin，不匹配子路径（/admin/login、/admin/_next 等不受影响）
export const config = {
  matcher: '/admin',
}
