/**
 * 带 cookie 的写操作的同源校验（防 CSRF）。
 *
 * ==================== 为什么不能「没有 Origin 就放行」 ====================
 *
 * 旧实现在三个地方各写了一份 `if (!origin) return true`：
 *   - lib/comments-admin-guard.ts 的 sameOrigin()
 *   - app/api/change-password/route.ts
 *   - app/api/feishu/bind/route.ts
 *
 * 「Origin 缺失」在**现代浏览器发起的跨站请求里根本不会出现**：CORS 规范要求
 * 浏览器对所有 CORS 安全的方法（POST/PUT/PATCH/DELETE）附带 Origin。所以
 * 「没有 Origin ⇒ 放行」这条分支唯一服务的就是非浏览器客户端（curl、脚本），
 * 而它们本来也发不出「借用受害者 cookie」的请求 —— 它对 CSRF 毫无防护价值，
 * 却把闸门开给了任何能让浏览器不发 Origin 的路径（旧版浏览器、部分
 * same-origin 导航形态、被中间件改写头的链路）。
 *
 * 真正该用的是一个浏览器**无法伪造**的信号：Sec-Fetch-Site。
 *   1. Origin 存在 → 严格同源比较。
 *   2. Origin 缺失 → 看 Sec-Fetch-Site：
 *      - `same-origin` / `same-site` / `none`（直接导航）→ 放行；
 *      - `cross-site` → 拒绝（这就是跨站攻击的指纹）；
 *      - 头缺失（非浏览器客户端）→ 放行，因为它无法携带受害者的 cookie 完成 CSRF。
 *
 * 注意：`same-site` 放行意味着跨子域被允许。本站只有一个业务域，若将来上多子域
 * 且其中任一子域可被第三方内容影响，应把 `same-site` 收紧掉。
 *
 * 已知的本地联调限制（沿用改动前注释的结论）：博客 4321 代理 → CMS 9527 时，
 * proxy.mjs 把 Host 重写成 9527 而 Origin 仍是 4321，全等比较必然判跨站。
 * 后台写操作请在 9527 直连做，4321 只用来验前台。
 */
export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get('origin')
  if (originHeader) {
    try {
      return new URL(originHeader).origin === new URL(request.url).origin
    } catch {
      // 畸形 Origin（非 URL 字符串）按跨站处理，不能让 new URL 抛 500
      return false
    }
  }

  // Origin 缺失：退到浏览器同样无法伪造的 Sec-Fetch-Site
  const site = request.headers.get('sec-fetch-site')
  if (!site) return true
  return site !== 'cross-site'
}
