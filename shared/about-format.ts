/**
 * 关于页「正文 / 便签 / 技能环」的统一格式层
 *
 * 后台存进 SiteSettings 的 textarea 字段，但内容格式升级为用户友好的形态：
 *  - 正文：纯文本 + `==高亮==` 记号（不再要求管理员手写 HTML 标签）
 *  - 便签 / 技能：JSON 数组（行编辑器产出），颜色 = 预设 token 或任意 hex
 *
 * 三条硬约束（前后端 / 旧数据都必须满足，否则会出现「修好一边漏一边」）：
 *  1. 读取端一律走本模块的 parse*，同时接受 JSON 与旧「竖线」文本，旧库无需迁移；
 *  2. 渲染端 HTML 只能由 format* 生成：先整体转义、再把 ==x== 换成高亮 span，
 *     正文里出现的任何尖括号都只是文字——比旧的 sanitizeInlineHtml 白名单更严；
 *  3. 颜色 token 映射到 --sticky-* CSS 变量（跟随明暗主题），hex 原样透传（格式校验后）。
 */

/** 便签条目。color：预设 token（yellow/cyan/pink/green/purple）或 '#rrggbb' */
export interface NoteItem {
  title: string;
  subtitle: string;
  color: string;
}

/** 技能环条目。color 同上 */
export interface SkillItem {
  label: string;
  sublabel: string;
  value: number;
  color: string;
}

/** 预设色板：token → 主题变量；swatch 仅用于后台取色点的近似展示 */
export const PRESET_COLORS: ReadonlyArray<{ token: string; label: string; swatch: string }> = [
  { token: 'yellow', label: '淡黄', swatch: '#ffdf8a' },
  { token: 'cyan', label: '湖青', swatch: '#7ddbd3' },
  { token: 'pink', label: '樱粉', swatch: '#ffb7c9' },
  { token: 'green', label: '草绿', swatch: '#c9e6a4' },
  { token: 'purple', label: '雾紫', swatch: '#d8c4f7' },
];

const PRESET_TOKENS = new Set(PRESET_COLORS.map((c) => c.token));
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 校验并归一颜色：合法 token / hex 之外一律丢弃（回退由渲染端 CSS 兜底） */
export function normalizeAboutColor(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (PRESET_TOKENS.has(value)) return value;
  if (HEX_COLOR.test(value)) return value.toLowerCase();
  return '';
}

/**
 * 颜色 → 可直接进 style 的 CSS 值：token 换成主题变量（明暗双主题自动跟随），
 * hex 原样，非法值返回空串（调用方据此省略 style，落回 CSS 默认色）。
 */
export function resolveAboutColor(raw: unknown): string {
  const color = normalizeAboutColor(raw);
  if (!color) return '';
  return PRESET_TOKENS.has(color) ? `var(--sticky-${color})` : color;
}

const clampPercent = (n: unknown): number => Math.min(100, Math.max(0, Number(n) || 0));

/** 竖线旧格式的一行 → 分段数组（兼容全角｜） */
const splitLegacyLine = (line: string): string[] =>
  line
    .replace(/｜/g, '|')
    .split('|')
    .map((s) => s.trim());

function parseJsonArray(raw: string): unknown[] | null {
  if (!raw.trim().startsWith('[')) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 解析便签：JSON 优先，旧「标题|副文字|颜色」行文本自动兼容 */
export function parseNotes(raw?: string | null): NoteItem[] {
  if (!raw || !raw.trim()) return [];
  const json = parseJsonArray(raw);
  if (json) {
    return json.map((entry) => {
      const item = (entry ?? {}) as Partial<NoteItem>;
      return { title: String(item.title ?? ''), subtitle: String(item.subtitle ?? ''), color: normalizeAboutColor(item.color) };
    });
  }
  const out: NoteItem[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = splitLegacyLine(line);
    if (!parts[0]) continue;
    out.push({ title: parts[0], subtitle: parts[1] ?? '', color: normalizeAboutColor(parts[2] ?? '') });
  }
  return out;
}

/** 解析技能环：JSON 优先，旧「名称|副标题|数值|颜色」行文本自动兼容 */
export function parseSkills(raw?: string | null): SkillItem[] {
  if (!raw || !raw.trim()) return [];
  const json = parseJsonArray(raw);
  if (json) {
    return json.map((entry) => {
      const item = (entry ?? {}) as Partial<SkillItem>;
      return {
        label: String(item.label ?? ''),
        sublabel: String(item.sublabel ?? ''),
        value: clampPercent(item.value),
        color: normalizeAboutColor(item.color),
      };
    });
  }
  const out: SkillItem[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = splitLegacyLine(line);
    if (!parts[0]) continue;
    out.push({
      label: parts[0],
      sublabel: parts[1] ?? '',
      value: clampPercent(parts[2]),
      color: normalizeAboutColor(parts[3] ?? ''),
    });
  }
  return out;
}

export function stringifyNotes(items: NoteItem[]): string {
  return JSON.stringify(items.map((it) => ({ title: it.title, subtitle: it.subtitle, color: it.color })));
}

export function stringifySkills(items: SkillItem[]): string {
  return JSON.stringify(items.map((it) => ({ label: it.label, sublabel: it.sublabel, value: it.value, color: it.color })));
}

/** 便签 → 批量文本（每行「标题|副文字|颜色」，颜色可省略） */
export function notesToBatch(items: NoteItem[]): string {
  return items.map((it) => [it.title, it.subtitle, it.color].filter((s) => s !== '').join('|')).join('\n');
}

/** 技能 → 批量文本（每行「名称|副标题|数值|颜色」） */
export function skillsToBatch(items: SkillItem[]): string {
  return items.map((it) => [it.label, it.sublabel, String(it.value), it.color].filter((s) => s !== '').join('|')).join('\n');
}

/** 批量文本 → 便签：省略颜色的行沿用同位置旧条目的颜色（编辑文字不丢已选色） */
export function notesFromBatch(text: string, previous: NoteItem[]): NoteItem[] {
  return parseNotes(text).map((it, i) => ({ ...it, color: it.color || previous[i]?.color || '' }));
}

/** 批量文本 → 技能：同上 */
export function skillsFromBatch(text: string, previous: SkillItem[]): SkillItem[] {
  return parseSkills(text).map((it, i) => ({ ...it, color: it.color || previous[i]?.color || '' }));
}

/**
 * 旧正文里的 HTML 写法 → ==记号==：编辑器载入时调用，让存量数据在界面上
 * 直接呈现为新语法，保存后字段里就不再有 HTML。
 */
export function legacyHtmlToMarker(text: string): string {
  return String(text ?? '')
    .replace(/<span\b[^>]*class\s*=\s*["'][^"']*marker-highlight[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '==$1==')
    .replace(/<br\s*\/?>/gi, '\n');
}

const escapeText = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * 一行正文 → 安全 HTML：整体转义后仅把 ==x== 还原为高亮 span。
 * 输出只可能是「文字 + marker-highlight span」，无任何属性注入面。
 */
export function formatAboutLine(line: string): string {
  return escapeText(line).replace(/==([^=\n]+)==/g, '<span class="marker-highlight">$1</span>');
}

/** 正文 textarea 原文 → 段落 HTML 数组（旧 HTML 自动转记号；一行一段） */
export function splitAboutParagraphs(raw?: string | null): string[] {
  if (!raw) return [];
  return legacyHtmlToMarker(raw)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(formatAboutLine);
}
