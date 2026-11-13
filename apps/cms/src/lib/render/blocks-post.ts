/**
 * 文章详情页区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry } from '../blog-sync'
import {
  formatDate,
  getShanghaiPeriod,
  sortPosts,
  getPostDescription,
  getPostCategory,
  getPostTags,
  getPostCover,
  getReadingMinutes,
  getAdjacentPosts,
  getRelatedPosts,
  supabaseImageTransform,
} from 'cloud-blog/shared/post-utils'
import { footerBlocks, renderMorePanel, renderNavLinks } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { renderMarkdown } from './markdown'
import { escapeAttr, escapeHtml, getPostPath, toDate } from './util'

export function renderArticleHeader(post: MdEntry): string {
  const category = getPostCategory(post)
  const date = toDate(post.data.date)
  const tags = getPostTags(post)
  const description = getPostDescription(post)
  const readingMinutes = getReadingMinutes(post)
  const updated = toDate(post.data.updated)

  const meta = [
    category ? `<span>${escapeHtml(category)}</span>` : '',
    date ? `<time datetime="${date.toISOString()}">${formatDate(date)}</time>` : '',
    updated ? `<span>更新于 ${formatDate(updated)}</span>` : '',
    `<span>${readingMinutes} 分钟阅读</span>`,
  ].join('')

  const tagHtml =
    tags.length > 0
      ? `<div class="tag-list" aria-label="标签">${tags.map((t: string) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
      : ''

  return `<div class="post-meta">${meta}</div>
  <h1>${escapeHtml(post.data.title)}</h1>
  <p>${escapeHtml(description)}</p>
  ${tagHtml}`
}

/** 文章正文内容（锚点 posts/[...slug].astro 的 div[data-sync-block="postContent"]） */

export async function renderArticleContent(post: MdEntry, altMap: Map<string, string>): Promise<string> {
  const { html } = await renderMarkdown(post.body, altMap)
  return html
}

/** 文章侧栏目录内容（锚点 posts/[...slug].astro 的 aside[data-sync-block="tocSidebar"]） */

export function renderTocSidebar(
  tocGroups: Array<{ slug: string; text: string; children: Array<{ slug: string; text: string }> }>,
): string {
  const items = tocGroups
    .map(
      (group) => `<li class="toc__group toc__item--depth-2">
  <a href="#${escapeAttr(group.slug)}">${escapeHtml(group.text)}</a>
  ${
    group.children.length > 0
      ? `<div class="toc__sub"><ol class="toc__children">${group.children
          .map(
            (child) =>
              `<li class="toc__item--depth-3"><a href="#${escapeAttr(child.slug)}">${escapeHtml(child.text)}</a></li>`,
          )
          .join('')}</ol></div>`
      : ''
  }
</li>`,
    )
    .join('')
  return `<nav class="toc" aria-labelledby="toc-heading">
    <h2 id="toc-heading">目录</h2>
    <ol>${items}</ol>
  </nav>`
}

/**
 * 文章版权条（锚点 posts/[...slug].astro 的 section.post-license）。
 * 与 Astro 模板里的同名区块逐字对应：三行扁平信息 + 右上角 CC 水印。
 * 日期与时段走 shared/post-utils 的固定 Asia/Shanghai 实现，
 * 「文章地址」用文章标题（不是 URL）—— 与前台一致，正文里另有 <a> 指向绝对地址。
 */

export function renderArticleLicense(post: MdEntry, author: string, siteName: string): string {
  const url = `${site.url.replace(/\/$/, '')}${getPostPath(post)}`
  const owner = escapeHtml(author)
  const title = escapeHtml(post.data.title)
  const brand = escapeHtml(siteName)
  const date = post.data.date
  const dateText = formatDate(date)
  const period = getShanghaiPeriod(date)
  // post.data.date 在同步链路里来自 `String(doc.createdAt)`（见 blog-sync.ts），
  // 是字符串而不是 Date，所以 <time datetime> 要重新归一化成 ISO，
  // 否则会把非标准日期串原样塞进属性里。归一化失败就不写这个属性。
  const iso = (() => {
    if (!date) return ''
    const d = date instanceof Date ? date : new Date(date as string)
    return isNaN(d.getTime()) ? '' : d.toISOString()
  })()
  const posted = dateText
    ? ` 于 <time${iso ? ` datetime="${escapeAttr(iso)}"` : ''}>${dateText}${period ? ` ${period}` : ''}</time> 发布`
    : ' 发布'

  return `<span class="post-license__watermark" aria-hidden="true">CC</span>
    <p class="post-license__line">本文由 <span class="post-license__author">${owner}</span>${posted}</p>
    <p class="post-license__line">文章地址：<a class="post-license__title-link" href="${escapeAttr(url)}">${title}</a></p>
    <p class="post-license__line">本站原创文章除特别声明外，均采用 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a> 许可协议。完整转载请注明来自 <a href="/">${brand}</a>！</p>`
}

/**
 * 相邻文章卡（上一篇/下一篇）：封面大图横幅，文字是「标题【分类】」。
 * 与 posts/[...slug].astro 里 adjacentCards 的 markup 逐字对应。
 *
 * 缺哪一侧就渲染一张不可点击的虚线占位卡，而不是只渲染一张：
 * 两列网格里只剩一张会撑满整行，且卡片会左右跳位，观感比「明确告诉读者到头了」更糟。
 *
 * 封面走 <img> 而不是内联 style 的 background-image —— 客户端同步净化器会把
 * style 里带 url( 的整条属性丢掉，写进 style 的背景在实时同步后会消失。
 */

export function renderAdjacentCard(direction: 'prev' | 'next', post: MdEntry | undefined): string {
  const label = direction === 'prev' ? '上一篇' : '下一篇'
  if (!post) {
    const emptyLabel = direction === 'prev' ? '已经是最早一篇了' : '已经是最新一篇了'
    return `<span class="post-nav__card post-nav__card--${direction} post-nav__card--empty">
  <span class="post-nav__text">
    <span class="post-nav__label">${label}</span>
    <span class="post-nav__title">${emptyLabel}</span>
  </span>
</span>`
  }

  // 相邻文章封面缩略图（显示 ~72px）：400px webp 变换
  const cover = supabaseImageTransform(getPostCover(post), { width: 400, quality: 72 })
  const category = getPostCategory(post)
  const thumb = cover
    ? `<img class="post-nav__cover" src="${escapeAttr(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="post-nav__cover post-nav__cover--fallback" aria-hidden="true"></span>`

  return `<a class="post-nav__card post-nav__card--${direction}" href="${escapeAttr(getPostPath(post))}">
  ${thumb}
  <span class="post-nav__mask" aria-hidden="true"></span>
  <span class="post-nav__text">
    <span class="post-nav__label">${label}</span>
    <span class="post-nav__title">${escapeHtml(post.data.title)}${
      category ? `<span class="post-nav__category">【${escapeHtml(category)}】</span>` : ''
    }</span>
  </span>
</a>`
}

/** 文章页脚内容（锚点 posts/[...slug].astro 的 footer[data-sync-block="articleFooter"]） */

export function renderArticleFooter(
  newer: MdEntry | undefined,
  older: MdEntry | undefined,
  related: MdEntry[],
  post: MdEntry,
  author: string,
  siteName: string,
): string {
  const licenseHtml = `<section class="post-license" aria-label="文章版权">
    ${renderArticleLicense(post, author, siteName)}
  </section>`

  // 横幅排在版权条**上方**（与模板顺序一致）。单篇文章（两篇都没有）时整块不渲染。
  const navHtml =
    newer || older
      ? `<nav class="post-nav" aria-label="相邻文章">
    ${renderAdjacentCard('prev', older)}
    ${renderAdjacentCard('next', newer)}
  </nav>`
      : ''

  const relatedHtml =
    related.length > 0
      ? `<section class="related-posts" aria-labelledby="related-heading">
  <h2 id="related-heading">相关文章</h2>
  <div class="related-posts__grid">
    ${related
      .map(
        (p) => `<a href="${escapeAttr(getPostPath(p))}">
    <span>${escapeHtml(getPostCategory(p) ?? '文章')}</span>
    <strong>${escapeHtml(p.data.title)}</strong>
    <small>${escapeHtml(getPostDescription(p))}</small>
  </a>`,
      )
      .join('')}
  </div>
</section>`
      : ''

  // 顺序必须与模板一致：横幅在上，版权条在中，相关文章在下。
  return `${navHtml}
  ${licenseHtml}
  ${relatedHtml}`
}

/** 归档页 header（分页时补上页码信息，与 archive/[page].astro 的文案保持一致） */

export async function postBlocks(ctx: SyncData, pathname: string): Promise<Record<string, string | null>> {
  const segs = pathname.split('/')
  // 例：/posts/tech/42 → ['','posts','tech','42']
  const postId = decodeURIComponent(segs[3] ?? '')
  const posts = sortPosts(ctx.posts)
  const post = posts.find((p) => String(p.id) === postId)
  if (!post) return { postContent: null }

  const { html, headings } = await renderMarkdown(post.body, ctx.mediaAltMap)
  const tocList = headings.filter((h) => h.depth >= 2 && h.depth <= 3)
  const tocGroups: Array<{ slug: string; text: string; children: Array<{ slug: string; text: string }> }> = []
  for (const heading of tocList) {
    if (heading.depth === 2 || tocGroups.length === 0) {
      tocGroups.push({ slug: heading.slug, text: heading.text, children: [] })
    } else {
      tocGroups[tocGroups.length - 1].children.push({ slug: heading.slug, text: heading.text })
    }
  }

  // 与 Astro 模板保持同一口径：h2+h3 的标题数 ≥2 就算有目录（模板用
  // tableOfContents.length >= 2）。之前这里错用了「h2 分组数」，导致只有 h3
  // 的文章模板判定有目录、注入侧判定无目录，侧栏被清空成空白列。
  const hasToc = tocList.length >= 2
  const { newer, older } = getAdjacentPosts(posts, post)
  const related = getRelatedPosts(posts, post)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, pathname),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    // 标题保持原始文本（未转义）：客户端直接赋给 document.title，
    // 服务端注入 <title> 时再统一做一次 HTML 转义。
    pageTitle: `${post.data.title} - ${siteName}`,
    articleHeader: renderArticleHeader(post),
    postContent: html,
    tocSidebar: hasToc ? renderTocSidebar(tocGroups) : '',
    articleFooter: renderArticleFooter(newer, older, related, post, settings?.siteAuthor ?? site.author, siteName),
  }
}

/** 归档分页条（锚点 archive/[...page].astro 的 div[data-sync-block="archivePager"]）；单页时返回 '' 清空 */
