/**
 * 图标渲染（与 Astro 的 Icon.astro 共用 shared/icon-paths）
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import {
  BRAND_ICONS,
  brandRenderSize,
  brandTransform,
  iconInnerMarkup,
  isBrandIcon,
} from 'cloud-blog/shared/icon-paths'
import { CATEGORY_COLORS } from './palette'
import { escapeAttr } from './util'

export function iconSvg(name: string, size = 20, className?: string, strokeWidth = 1.75): string {
  const inner = iconInnerMarkup(name)
  if (isBrandIcon(name)) {
    const brand = BRAND_ICONS[name]
    const renderSize = brandRenderSize(size)
    const transform = brandTransform(name)
    const cls = escapeAttr(['brand-glyph', className].filter(Boolean).join(' '))
    // 官方色写成内联自定义属性，实际 fill 由 .brand-glyph 按深浅主题取用
    const style = brand.color
      ? ` style="--glyph-color:${escapeAttr(brand.color)};--glyph-color-dark:${escapeAttr(brand.darkColor ?? brand.color)};"`
      : ''
    const g = transform ? `<g transform="${escapeAttr(transform)}">` : '<g>'
    return `<svg class="${cls}"${style} width="${renderSize}" height="${renderSize}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${g}${inner}</g></svg>`
  }
  const cls = className ? ` class="${escapeAttr(className)}"` : ''
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
}

// ---------------------------------------------------------------------------
// 标签墙 / 统计页配色（必须与 Astro 侧逐字一致，否则同一标签两页不同色）
// ---------------------------------------------------------------------------

/** 环形图 7 色：与 apps/blog/src/pages/stats.astro 的 CATEGORY_COLORS 同序。 */
