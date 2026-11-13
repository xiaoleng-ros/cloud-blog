/**
 * 归档页与分类/标签通用区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry } from '../blog-sync'
import {
  sortPosts,
  getCategories,
  getTags,
  getCategoryPath,
  getTagPath,
  ARCHIVE_PAGE_SIZE,
  getArchivePagePath,
  getArchivePageNumbers,
  getArchivePageYears,
  getArchiveTotalPages,
  parseArchivePage,
} from 'cloud-blog/shared/post-utils'
import { footerBlocks, renderMorePanel, renderNavLinks, renderPostSummary } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { escapeAttr, escapeHtml } from './util'

export function renderArchiveHeader(count: number, page: number, totalPages: number): string {
  const rangeLabel =
    count === 0 ? '暂无文章' : `${(page - 1) * ARCHIVE_PAGE_SIZE + 1} - ${Math.min(page * ARCHIVE_PAGE_SIZE, count)}`
  const meta =
    totalPages > 1 ? `<p class="archive-page__meta">第 ${page} / ${totalPages} 页 · 本页 ${rangeLabel} 篇</p>` : ''
  return `<p class="eyebrow">Archive</p>
  <h1>文章归档</h1>
  <p>目前收录 ${count} 篇文章，可以按时间、分类或标签浏览。</p>
  ${meta}`
}

/** 归档页分类/标签索引面板内容（锚点 archive.astro 的 section[data-sync-block="archiveSummary"]） */

export function renderArchiveSummary(
  categories: Array<{ name: string; count: number }>,
  tags: Array<{ name: string; count: number }>,
): string {
  const primaryTags = tags.slice(0, 16)
  const restTags = tags.slice(16)

  const catHtml = categories
    .map(
      (c) =>
        `<a href="${escapeAttr(getCategoryPath(c.name))}"><span>${escapeHtml(c.name)}</span><small>${c.count}</small></a>`,
    )
    .join('')

  const tagHtml = primaryTags
    .map(
      (t) =>
        `<a href="${escapeAttr(getTagPath(t.name))}"><span>${escapeHtml(t.name)}</span><small>${t.count}</small></a>`,
    )
    .join('')

  const restHtml =
    restTags.length > 0
      ? `<div class="term-more" data-term-more><div class="term-list term-list--rest">${restTags
          .map(
            (t) =>
              `<a href="${escapeAttr(getTagPath(t.name))}"><span>${escapeHtml(t.name)}</span><small>${t.count}</small></a>`,
          )
          .join('')}</div></div>
<button type="button" class="term-toggle" data-term-toggle aria-expanded="false">
  <span class="term-toggle__text">展开其余 ${restTags.length} 个</span>
  <svg class="term-toggle__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
</button>`
      : ''

  return `<div class="taxonomy-panel">
    <h2>${iconSvg('layers', 16)}分类</h2>
    <div class="term-list">${catHtml}</div>
  </div>
  <div class="taxonomy-panel">
    <h2>${iconSvg('hash', 16)}标签</h2>
    <div class="term-list">${tagHtml}</div>
    ${restHtml}
  </div>`
}

/** 归档页按年份分组列表（只渲染当前页的切片，页大小与前台共用 shared 口径） */

export function renderArchiveYears(years: Array<{ year: string; posts: MdEntry[]; yearCount: number }>): string {
  if (years.length === 0) return '<p class="archive-empty">这一页还没有文章。</p>'
  return years
    .map(
      (group) => `<section class="archive-year">
  <header class="archive-year__head">
    <h2 class="archive-year__num">${escapeHtml(group.year)}</h2>
    <span class="archive-year__count">${group.yearCount} 篇</span>
  </header>
  <div class="post-list">
    ${group.posts.map((p) => renderPostSummary(p, { hideYear: true, compact: true })).join('')}
  </div>
</section>`,
    )
    .join('')
}

/** 分类/标签切换器内容（锚点 categories|tags/*.astro 的 nav[data-sync-block="termSwitcher"]） */

export function renderArchivePager(page: number, totalPages: number): string {
  if (totalPages <= 1) return ''
  const step = (direction: 'prev' | 'next', href: string | null) => {
    const icon = direction === 'prev' ? iconSvg('arrow-left', 16) : iconSvg('arrow-right', 16)
    const inner = direction === 'prev' ? `${icon}<span>上一页</span>` : `<span>下一页</span>${icon}`
    return href
      ? `<a class="archive-pager__step" href="${escapeAttr(href)}" rel="${direction}">${inner}</a>`
      : `<span class="archive-pager__step is-disabled" aria-hidden="true">${inner}</span>`
  }
  const list = getArchivePageNumbers(page, totalPages)
    .map((num) =>
      num === 0
        ? '<li class="archive-pager__gap" aria-hidden="true">…</li>'
        : num === page
          ? `<li><span class="archive-pager__num is-current" aria-current="page">${num}</span></li>`
          : `<li><a class="archive-pager__num" href="${escapeAttr(getArchivePagePath(num))}">${num}</a></li>`,
    )
    .join('')
  return `<nav class="archive-pager" aria-label="归档分页" data-archive-pager>
    ${step('prev', page > 1 ? getArchivePagePath(page - 1) : null)}
    <ol class="archive-pager__list">${list}</ol>
    ${step('next', page < totalPages ? getArchivePagePath(page + 1) : null)}
  </nav>`
}

/** 归档页。path 形如 /archive/ 或 /archive/2/，只渲染该页的切片。 */

export function renderTermSwitcher(
  terms: Array<{ name: string; count: number }>,
  current: string,
  kind: 'categories' | 'tags',
): string {
  const pathFor = kind === 'categories' ? getCategoryPath : getTagPath
  return terms
    .map(
      (item) =>
        `<a href="${escapeAttr(pathFor(item.name))}" class="${item.name === current ? 'is-current' : ''}"><span>${escapeHtml(item.name)}</span><small>${item.count}</small></a>`,
    )
    .join('')
}

/** 文章列表（通用：分类/标签页 post-list） */

export async function archiveBlocks(ctx: SyncData, path: string): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const page = parseArchivePage(path)
  const totalPages = getArchiveTotalPages(posts.length)
  const pageYears = getArchivePageYears(posts, page)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name
  const pagePath = getArchivePagePath(page)

  return {
    brandName: siteName,
    // 导航高亮按当前分页路径判定，否则在第 2 页会丢掉「归档」高亮
    navLinks: renderNavLinks(ctx.nav, pagePath),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    archiveHeader: renderArchiveHeader(posts.length, page, totalPages),
    archiveSummary: renderArchiveSummary(getCategories(posts), getTags(posts)),
    archiveYears: renderArchiveYears(pageYears),
    archivePager: renderArchivePager(page, totalPages),
  }
}

/** 随笔页 */
