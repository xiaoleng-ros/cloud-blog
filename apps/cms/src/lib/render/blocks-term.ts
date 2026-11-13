/**
 * 分类页 / 标签词条页 / 标签墙
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import { buildSiteStats } from 'cloud-blog/shared/site-stats'
import {
  sortPosts,
  getCategories,
  getTags,
  getTagPath,
  getPostsByCategory,
  getPostsByTag,
} from 'cloud-blog/shared/post-utils'
import { renderTermSwitcher } from './blocks-archive'
import { footerBlocks, renderMorePanel, renderNavLinks, renderPostList } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { TAG_COLORS, tagChipScale, tagColorSlots } from './palette'
import { escapeAttr, escapeHtml } from './util'

export async function termBlocks(
  ctx: SyncData,
  pathname: string,
  kind: 'categories' | 'tags',
): Promise<Record<string, string | null>> {
  const term = decodeURIComponent(pathname.split('/')[2] ?? '')
  const allPosts = sortPosts(ctx.posts)
  const posts = kind === 'categories' ? getPostsByCategory(allPosts, term) : getPostsByTag(allPosts, term)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name
  const terms = kind === 'categories' ? getCategories(allPosts) : getTags(allPosts)

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, pathname),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    termTitle: escapeHtml(term),
    termSwitcher: renderTermSwitcher(terms, term, kind),
    termPostList: renderPostList(posts, true),
    termCount:
      kind === 'categories' ? `这个分类下共有 ${posts.length} 篇文章。` : `这个标签下共有 ${posts.length} 篇文章。`,
  }
}

/**
 * 标签墙页（/tags/）：页头 + 标签胶囊区。
 * 注意：/tags/ 必须排在 termBlocks 的 `startsWith('/tags/')` 之前，
 * 否则计数会按「空标签」的 termBlocks 分支渲染出错误内容。
 */

export async function tagsIndexBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name
  const tags = buildSiteStats(sortPosts(ctx.posts)).tags
  const colorSlots = tagColorSlots(tags.map((t) => t.name))

  const tagWall =
    tags.length === 0
      ? '<p class="tags-empty">还没有标签。</p>'
      : tags
          .map(
            (
              tag,
              index,
            ) => `<a href="${escapeAttr(getTagPath(tag.name))}" class="tagwall__chip" style="--chip-scale: ${tagChipScale(tag.count)}; --chip-bg: ${TAG_COLORS[colorSlots[index]]}" title="${escapeAttr(`${tag.count} 篇文章`)}">
        <span class="tagwall__icon" aria-hidden="true">${iconSvg('tag', 13)}</span>
        <span class="tagwall__name">${escapeHtml(tag.name)}</span>
        <b class="tagwall__count">${tag.count}</b>
      </a>`,
          )
          .join('\n      ')

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/tags'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    tagsHeader: `<div class="tags-hero__top">
    <p class="eyebrow">Tags</p>
    <h1 class="tags-hero__title">标签墙</h1>
  </div>
  <p class="tags-hero__sub">拾取标签，发现更多感兴趣的内容</p>
  <div class="tags-hero__rule" aria-hidden="true"><i></i></div>
  <p class="tags-hero__count">共 <b>${tags.length}</b> 个标签</p>`,
    tagWall,
  }
}

/**
 * 统计页「分类一瞥」面板（环形图 + 图例）。
 * 返回的是 <section class="stats-panel"> 的 innerHTML，所以连 <h2> 标题一起渲染
 * （标题里的分类总数与数据相关，本就该跟数据走）。
 */
