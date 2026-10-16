/**
 * 后台「每行一条 文字 链接」自由文本的统一解析器。
 *
 * 导航（payload-api.parseNavLines）、社交（site-settings.parseSocials）、页脚
 * （site-settings.parseFooterLines）各自实现了一遍切分逻辑：
 *   - 导航/页脚用 lastIndexOf(' ')（文字在前、链接在后）
 *   - 社交用 indexOf(' ')（平台在前、链接在后）
 * 同一份数据（如「GitHub https://github.com/x」）在两个方向解析出相反结果，
 * 后台改一个 textarea 可能悄悄改变前台多处文案。这里收敛成一份：
 * 「空格分隔、第一段为名称/平台、最后一段为链接」，三个入口共用。
 * 差异由参数保留：allowEmptyHref 允许「只有名称没有链接」（页脚纯文字标签）。
 */
import { safeHref } from './html-safety';

export interface ParsedLineItem {
  /** 名称 / 平台 */
  name: string;
  /** 链接；不安全或无链接时按 allowEmptyHref 决定是 '' 还是惰性 fallback */
  href: string;
}

/**
 * 把「每行一条 `名称 链接`」文本解析为条目数组。
 * @param raw 后台 textarea 原文
 * @param hrefFallback 链接不安全（javascript:/data: 等）或行末无链接时的取值
 * @param allowEmptyHref true 时「只有名称」的行以 href: '' 保留（页脚纯文字标签）；
 *        false 时该行直接丢弃（导航/社交必须有链接才有意义）
 */
export function parseFreeTextLines(
  raw?: string | null,
  hrefFallback: string = '#',
  allowEmptyHref = false,
): ParsedLineItem[] {
  if (!raw) return [];
  const out: ParsedLineItem[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.lastIndexOf(' ');
    if (sp === -1) {
      if (!allowEmptyHref) continue;
      out.push({ name: trimmed, href: '' });
      continue;
    }
    const name = trimmed.slice(0, sp).trim();
    const href = trimmed.slice(sp + 1).trim();
    if (!name || !href) {
      if (!allowEmptyHref) continue;
      out.push({ name, href: '' });
      continue;
    }
    // 协议白名单：javascript:/data: 等一律按 fallback 处理，不进 href
    out.push({ name, href: safeHref(href, hrefFallback) });
  }
  return out;
}
