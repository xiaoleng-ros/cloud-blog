/**
 * 前后端共享的「自由文本入口」安全工具
 *
 * 后台的导航 / 社交链接 / 页脚 / 项目链接 / 关于页正文都是管理员自由填写的文本，
 * 最终会进入前台的 `<a href>`。前台有两套渲染链路
 * （Astro 静态模板 + CMS 的 /api/blog-sync 区块字符串），两边必须共用同一份判断，
 * 否则修好一边漏掉另一边。
 */

/** href 允许的协议。相对路径（`/posts/1/`）与锚点（`#top`）不带协议，天然允许。 */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * href 协议白名单校验（只判断协议，不做域名白名单）。
 *
 * 拒绝以下几类：
 *  - 协议不在白名单内：`javascript:` / `data:` / `vbscript:` / `file:` …
 *  - 含控制字符：浏览器会忽略 URL 里的 `\n` `\t`，`java\u0009script:` 能绕过只看前缀的检查
 *  - 含反斜杠：部分浏览器把 `\\host` 等同 `//host` 解析
 *  - 协议相对链接 `//host`：不带协议就跳到外部域，后台填写里几乎不可能是有意为之
 */
export function isSafeHref(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (!value) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('//')) return false;
  const scheme = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!scheme) return true;
  return ALLOWED_SCHEMES.has(scheme[1].toLowerCase());
}

/** 校验并返回可安全写入 href 的值；不安全或缺失时返回 fallback */
export function safeHref(raw: unknown, fallback = '#'): string {
  return isSafeHref(raw) ? String(raw).trim() : fallback;
}
