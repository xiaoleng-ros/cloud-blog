/**
 * 客户端真实 IP 解析 —— 全站唯一入口。
 *
 * ==================== 为什么不能用 XFF 首段 ====================
 *
 * X-Forwarded-For 是**追加式**头部：代理链上每一跳都把「上一跳看到的对端地址」
 * append 到末尾。攻击者可以自己在请求里带 `X-Forwarded-For: 1.2.3.4`，
 * 平台网关只会把真实对端**追加在后面**，于是变成 `1.2.3.4, <真实IP>`。
 *
 * 取首段 = 取攻击者写的那一段 → 换一个伪造值就换一个限流桶，
 * 所有基于 IP 的限流（评论 1 次/秒、传图 30 张/小时、登录 10 次/分）全部失效。
 * 这是典型的「限流形同虚设」漏洞，不是理论风险：只要 `curl -H` 一个头就能绕过。
 *
 * 正确做法是取**最右侧**（最后一跳代理写入的、客户端无法伪造的那一段）。
 *
 * ==================== 为什么还要 checkIp ====================
 *
 * 取右侧段之后仍要校验它真的是 IP：某些平台/网关会写入 `unknown`、空值、
 * 甚至带端口的 `1.2.3.4:5678`。若不校验：
 *   - 非法值让 `new URL()` / DNS 查询 / ip2region 解析抛错（评论列表直接 500）
 *   - 更糟的是全部落到同一个非法桶，限流失效或误伤
 */

/** 从 XFF 里取最右侧的合法 IP；该段由平台网关写入，客户端无法伪造 */
const XFF_HEADER = 'x-forwarded-for'

/** 把 `1.2.3.4:5678` / `[::1]:443` 这类带端口的形态剥成纯 IP */
function stripPort(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // IPv6 带端口：[::1]:443
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close > 0) return trimmed.slice(1, close)
    return ''
  }
  // IPv4 带端口：1.2.3.4:5678（IPv6 裸地址含多个冒号，不按单个冒号切）
  const colons = trimmed.split(':').length - 1
  if (colons === 1) return trimmed.slice(0, trimmed.indexOf(':'))
  return trimmed
}

/** 严格校验：只接受可解析的 IPv4/IPv6，且拒绝内网/保留段（它们不可能是真实访客） */
export function isPublicIp(value: string): boolean {
  if (!value) return false
  const v = value.trim()
  // IPv4
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v)
  if (v4) {
    const octets = v4.slice(1, 5).map(Number)
    if (octets.some((n) => n > 255)) return false
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false // link-local
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a >= 224) return false // multicast / reserved
    return true
  }
  // IPv6（粗判：只排除明显非法的，具体归属交给下游）
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(':')) {
    if (v === '::' || v === '::1') return false
    if (/^f[cd]/i.test(v)) return false // ULA
    if (/^fe[89ab]/i.test(v)) return false // link-local
    return true
  }
  return false
}

/**
 * 取客户端真实 IP。返回空串表示「拿不到可信 IP」——
 * 调用方必须把空串当作「无法限流」而不是「同一个匿名桶」，
 * 否则所有取不到 IP 的请求会互相同归于尽。
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get(XFF_HEADER)
  if (xff) {
    // ⚠️ 从右往左找第一个合法 IP：最右段由平台写入，越往左越可能是伪造的
    const parts = xff.split(',')
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = stripPort(parts[i] ?? '')
      if (isPublicIp(candidate)) return candidate
    }
  }
  // 兜底头部（部分平台只注入这个，且它本身是单值、不可追加伪造）
  const real = request.headers.get('x-real-ip')
  if (real) {
    const candidate = stripPort(real)
    if (isPublicIp(candidate)) return candidate
  }
  const cf = request.headers.get('cf-connecting-ip')
  if (cf) {
    const candidate = stripPort(cf)
    if (isPublicIp(candidate)) return candidate
  }
  return ''
}
