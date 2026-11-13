/**
 * 统计页区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import { siteAge } from 'cloud-blog/shared/site-age'
import { buildSiteStats } from 'cloud-blog/shared/site-stats'
import { formatDate, sortPosts, getCategoryPath, getTagPath } from 'cloud-blog/shared/post-utils'
import { footerBlocks, renderMorePanel, renderNavLinks } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { CATEGORY_COLORS, TAG_COLORS, tagColorSlots } from './palette'
import { escapeAttr, escapeHtml, toDate } from './util'

export function renderStatsCategories(stats: ReturnType<typeof buildSiteStats>): string {
  const heading = `<h2 id="stats-cat-title" class="stats-panel__title">
          ${iconSvg('spark', 16)}分类一瞥
          <small>共 ${stats.categoryCount} 个分类</small>
        </h2>`

  if (stats.categories.length === 0) {
    return `${heading}
        <p class="stats-empty">还没有文章。</p>`
  }

  // 环形图：每段占比切一个 conic-gradient 色块，段间留缝（段宽的 22%，上限 1.5%）。
  // 缝隙不能写死：占比只有 1.5% 的分类会被整段吃掉反而消失。
  const GAP_MAX = 1.5
  const stops = stats.categories
    .map((cat, index) => {
      const from = stats.categories.slice(0, index).reduce((sum, c) => sum + c.ratio, 0)
      const start = from * 100
      const span = cat.ratio * 100
      const end = start + span
      const gap = Math.min(GAP_MAX, span * 0.22)
      const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length]
      // 单分类时首尾相接会留下一道缝，这里让最后一段补回来
      const isLast = index === stats.categories.length - 1
      return `${color} ${start.toFixed(2)}% ${(isLast ? end : end - gap).toFixed(2)}%`
    })
    .join(', ')

  const legend = stats.categories
    .map(
      (cat, index) => `<li class="stats-legend__row">
                  <span class="stats-legend__dot" style="background: ${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}" aria-hidden="true"></span>
                  <a href="${escapeAttr(getCategoryPath(cat.name))}" class="stats-legend__name">
                    ${escapeHtml(cat.name)}
                  </a>
                  <span class="stats-legend__pct">${(cat.ratio * 100).toFixed(1)}%</span>
                  <small>${cat.count} 篇</small>
                </li>`,
    )
    .join('\n              ')

  const ariaLabel = `分类占比：${stats.categories.map((c) => `${c.name} ${c.count} 篇`).join('，')}`

  return `${heading}
        <div class="stats-donut">
            <div
              class="stats-donut__ring"
              style="background: conic-gradient(${stops})"
              role="img"
              aria-label="${escapeAttr(ariaLabel)}"
            >
              <div class="stats-donut__hole">
                <b>${stats.postCount}</b>
                <span>篇</span>
              </div>
            </div>
            <ul class="stats-legend">
              ${legend}
            </ul>
          </div>`
}

/** 统计页「标签墙」面板。同样返回 <section> 的 innerHTML。 */

export function renderStatsTagwall(stats: ReturnType<typeof buildSiteStats>): string {
  const heading = `<h2 id="stats-tag-title" class="stats-panel__title">
          ${iconSvg('hash', 16)}标签墙
          <small>共 ${stats.tagCount} 个标签</small>
        </h2>`

  if (stats.tags.length === 0) {
    return `${heading}
        <p class="stats-empty">还没有标签。</p>`
  }

  const colorSlots = tagColorSlots(stats.tags.map((t) => t.name))
  const chips = stats.tags
    .map(
      (tag, index) =>
        `<a href="${escapeAttr(getTagPath(tag.name))}" class="stats-tag" style="--tag-scale: ${Math.min(1, 0.78 + tag.count * 0.06).toFixed(2)}; --tag-bg: ${TAG_COLORS[colorSlots[index]]}" title="${escapeAttr(`${tag.count} 篇`)}">${escapeHtml(tag.name)}<b>${tag.count}</b></a>`,
    )
    .join('\n              ')

  return `${heading}
        <div class="stats-tagwall">
              ${chips}
            </div>`
}

/** 统计页（/stats/）：概览卡 + 分类一瞥 + 标签墙 + 逐年归档 + 底部更新行 */

export async function statsBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const stats = buildSiteStats(posts)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  // 概览卡：与 stats.astro 结构逐字一致（图标 + 数字 + 文案标签）
  const card = (
    mod: string,
    iconName: string,
    value: string,
    label: string,
  ) => `<div class="stats-card stats-card--${mod}">
    <span class="stats-card__icon" aria-hidden="true">${iconSvg(iconName, 20)}</span>
    <div class="stats-card__body">
      <b>${value}</b>
      <span>${label}</span>
    </div>
  </div>`

  // 逐年归档：字数转「万字 / 千字」（与 stats.astro 的 formatWords 同口径）
  const formatWords = (words: number) => {
    if (words >= 10_000) return `${(words / 10_000).toFixed(1)} 万字`
    if (words >= 1_000) return `${(words / 1_000).toFixed(1)} 千字`
    return `${words} 字`
  }
  // 逐年归档面板：锚点在 <section class="stats-panel"> 上，整段（含标题）都要渲染，
  // 否则同步会把标题一并替换掉（标题里的年份范围与数据相关，本就该跟数据走）
  const yearsList =
    stats.years.length === 0
      ? '<p class="stats-empty">还没有带日期的文章。</p>'
      : `<ol class="stats-years">${stats.years
          .map(
            (row) => `<li class="stats-years__row">
    <b class="stats-years__year">${escapeHtml(row.year)}</b>
    <span class="stats-years__cell">${iconSvg('archive', 13)}${row.posts} 篇</span>
    <span class="stats-years__cell stats-years__cell--tags">${iconSvg('hash', 13)}${row.tags} 标签</span>
    <span class="stats-years__cell stats-years__cell--words">${iconSvg('download', 13)}${escapeHtml(formatWords(row.words))}</span>
    <a href="/archive" class="stats-years__more" aria-label="查看 ${escapeHtml(row.year)} 年归档">${iconSvg('arrow-right', 14)}</a>
  </li>`,
          )
          .join('')}</ol>`
  const yearsHtml = `<h2 id="stats-year-title" class="stats-panel__title">
        ${iconSvg('clock', 16)}文章归档
        <small>
          ${escapeHtml(stats.firstYear)} — ${escapeHtml(stats.lastYear)}
        </small>
      </h2>
      ${yearsList}`

  // 底部行：有内容显示「最近更新于 X」，完全没有内容才退回「站点已运行」兜底（与 stats.astro 一致）
  const latestUpdate = [...posts.map((p) => toDate(p.data.date)), ...ctx.notes.map((n) => toDate(n.data.date))]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]
  let statsSince = ''
  if (latestUpdate) {
    statsSince = `${iconSvg('clock', 14)}\n最近更新于 <b>${escapeHtml(formatDate(latestUpdate))}</b>`
  } else {
    const age = siteAge(String(settings?.siteCreatedAt ?? '').trim())
    if (age) {
      statsSince = `${iconSvg('clock', 14)}\n站点已运行 <b>${age.totalDays}</b> 天（${age.years} 年 ${age.months} 月 ${age.days} 天）`
    }
  }

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/stats'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    statsCards: [
      card('blue', 'archive', String(stats.postCount), '文章统计'),
      card('yellow', 'spark', stats.wordCount.toLocaleString('zh-CN'), '字数统计'),
      card('green', 'hash', String(stats.tagCount), '标签统计'),
      card('pink', 'layers', String(ctx.notes.length), '随笔统计'),
    ].join('\n    '),
    statsYears: yearsHtml,
    statsSince,
    statsCategories: renderStatsCategories(stats),
    statsTagwall: renderStatsTagwall(stats),
  }
}

/** 关于页 */
