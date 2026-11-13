/**
 * 开发期跨端口 CORS。
 *
 * ==================== 为什么需要它 ====================
 *
 * 生产是前后台同域（EdgeOne 一体化：/ 前台、/api 与 /admin 后台），浏览器从不发预检，
 * 所以这些接口历史上一个 CORS 头都没有 —— 线上一直正常。
 *
 * 但本地开发是「前台 3000（或经 proxy 的 4321） / 后台 9527」两个端口：
 * 评论组件、同步轮询、申请表单全部跨站，浏览器会
 *   1. 先发 OPTIONS 预检；
 *   2. 拿不到 Access-Control-Allow-Origin 就直接拦掉真实请求。
 *
 * 表现非常迷惑：`curl` 直接打接口一切正常，页面上却是空白/一直加载中
 * （2026-11-02 评论区的「看不见」就是这么来的）。
 *
 * ==================== 规则 ====================
 *
 * - 生产：**默认不加任何头**（同源请求本来也不需要），只有显式配置
 *   `CMS_CORS_ORIGINS`（逗号分隔）的来源才放行 —— 用于将来前台独立部署到别的域名。
 * - 开发：放行 localhost / 127.0.0.1 / [::1] 的任意端口。
 * - 一律回具体 Origin（绝不回 `*`），并带 `Vary: Origin`，避免被缓存串味。
 * - `Access-Control-Allow-Credentials: true` 是必须的：Waline 会带 cookie 读登录态。
 */

function isLoopback(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  } catch {
    return false
  }
}

function allowedOriginsFromEnv(): string[] {
  return (process.env.CMS_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 该请求的 Origin 是否可信；不可信时返回空对象（无 CORS 头 = 浏览器照常拦截） */
export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin) return {}

  const isDev = process.env.NODE_ENV !== 'production'
  const allowed = isDev ? isLoopback(origin) : allowedOriginsFromEnv().includes(origin)
  if (!allowed) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    // 把浏览器预检里点名的头部原样放回去（Waline 会带 content-type 等）
    'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') ?? 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

/**
 * 给响应补 CORS 头。
 *
 * 不能直接 `response.headers.set()`：`Response.json()` 产出的 Headers 可能是
 * 不可变的 guard 状态，某些运行时上会抛 TypeError。重建一个响应最稳。
 */
export function withCors(request: Request, response: Response): Response {
  const headers = corsHeadersFor(request)
  if (Object.keys(headers).length === 0 || response.status === 101) return response

  const merged = new Headers(response.headers)
  for (const [key, value] of Object.entries(headers)) merged.set(key, value)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

/** 预检响应：204 + CORS 头；来源不可信时返回 403（不带头，浏览器照样拦） */
export function preflightResponse(request: Request): Response {
  const headers = corsHeadersFor(request)
  if (Object.keys(headers).length === 0) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers })
}
