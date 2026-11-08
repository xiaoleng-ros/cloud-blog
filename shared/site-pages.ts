/**
 * 链接形态判定 —— 前台与 CMS 共用。
 *
 * 导航项的链接要么是站内路径（/stats、/tags、用户新页面自己起的英文标识），
 * 要么是跳到站外的第三方地址（https://github.com/...）。后台弹窗据此切换
 * 「导航英文」与「网址」两种输入形态，前台据此决定要不要 target="_blank"。
 */

/**
 * 链接是否指向站外（需要新窗口打开）。
 *
 * 判据只看协议前缀，不看域名：站内绝对地址（https://自己的域名/x）在语义上仍是站内，
 * 但既然写成了完整 URL，按外链处理更符合用户预期（新标签打开，不丢当前阅读位置）。
 * mailto:/tel: 同理 —— 它们不是页面跳转，交给浏览器处理即可。
 */
export function isExternalHref(href: string): boolean {
  const value = href.trim().toLowerCase()
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('//')
  )
}

/**
 * 用户输入的 URL 是否可用作外链。
 *
 * 只放行 http/https/mailto/tel：`javascript:` 与 `data:` 会把导航变成 XSS 入口
 * （见 shared/html-safety 的 safeHref，这里在录入侧再拦一道，避免脏数据落库）。
 */
export function isValidExternalHref(href: string): boolean {
  const value = href.trim()
  if (!value) return false
  if (value.startsWith('//')) return true
  return /^(https?:\/\/|mailto:|tel:)/i.test(value)
}
