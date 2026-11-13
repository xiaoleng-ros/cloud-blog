/**
 * 标签墙 / 统计页配色（须与 Astro 侧逐字一致）
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

export const CATEGORY_COLORS = [
  'var(--brand)',
  'var(--sticky-cyan)',
  'var(--sticky-purple)',
  'var(--sticky-green)',
  'var(--sticky-pink)',
  'var(--sticky-yellow)',
  'var(--border-strong)',
]

/** 标签 6 色：与 stats.astro、tags/index.astro 的 TAG_COLORS 同序。 */

export const TAG_COLORS = [
  'var(--sticky-yellow)',
  'var(--sticky-green)',
  'var(--sticky-cyan)',
  'var(--sticky-pink)',
  'var(--sticky-purple)',
  'var(--brand)',
]

/**
 * 按标签名散列出起始色下标。不用 index % 长度：标签一多会连着好几颗同色。
 * 散列还保证同一标签每次刷新颜色稳定，不然墙面会「抖动」。
 */

export function hashOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 100_000
  return hash
}

/**
 * 逐个分配颜色，并躲开前一颗的颜色。
 * 只靠散列不够：6 种颜色铺 11 个标签，相邻同色的概率不低，看着像渲染坏了。
 * 代价是颜色分布略微不均，换来整片没有相邻重复。
 */

export function tagColorSlots(names: string[]): number[] {
  const slots: number[] = []
  let prev = -1
  for (const name of names) {
    const base = hashOf(name) % TAG_COLORS.length
    const slot = base === prev ? (base + 1) % TAG_COLORS.length : base
    slots.push(slot)
    prev = slot
  }
  return slots
}

/**
 * /tags/ 页胶囊字号档位。三档够用——连续公式在 count=1 与 2 时几乎一样大看不出差别。
 * 1.34 是实测上限，再大就撑破药丸圆角比例。
 */

export function tagChipScale(count: number): number {
  if (count >= 3) return 1.34
  if (count === 2) return 1.16
  return 1
}

// ---------------------------------------------------------------------------
// Markdown 渲染（与 Astro 构建管线一致：插件顺序 + shiki github-dark 高亮）
// ---------------------------------------------------------------------------
