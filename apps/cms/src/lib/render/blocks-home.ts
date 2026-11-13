/**
 * 首页与通用页头/页脚区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry } from '../blog-sync'
import { safeHref } from 'cloud-blog/shared/html-safety'
import { siteAge } from 'cloud-blog/shared/site-age'
import { hasIcon } from 'cloud-blog/shared/icon-paths'
import {
  formatDate,
  sortPosts,
  sortPostsByDate,
  getPostDescription,
  getPostExcerpt,
  getPostCategory,
  getPostCover,
  toShanghaiParts,
  supabaseImageTransform,
} from 'cloud-blog/shared/post-utils'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { avatarOf, coverHue, getFooterData, getHeroData, getSocials, icpOf } from './site-settings'
import { currentYearShanghai, escapeAttr, escapeHtml, getPostPath, toDate } from './util'

export function renderPostSummary(post: MdEntry, opts: { hideYear?: boolean; compact?: boolean } = {}): string {
  const { hideYear = false, compact = false } = opts
  const date = toDate(post.data.date)
  const parts = toShanghaiParts(date)
  const monthDay = parts ? `${parts.month}·${parts.day}` : ''
  const excerpt = compact ? undefined : getPostExcerpt(post)
  const category = getPostCategory(post)

  const classList = ['post-row', compact && 'post-row--compact', !date && 'post-row--plain'].filter(Boolean).join(' ')

  return `<article class="${classList}">
  <a href="${escapeAttr(getPostPath(post))}">
    ${
      date
        ? `<time class="post-row__date" datetime="${date.toISOString()}"><span class="post-row__md">${monthDay}</span>${
            !hideYear ? `<span class="post-row__yy">${parts?.year ?? ''}</span>` : ''
          }</time>`
        : ''
    }
    <div class="post-row__main">
      <div class="post-row__line">
        <h3>${escapeHtml(post.data.title)}</h3>
        ${category ? `<span class="post-row__cat">${escapeHtml(category)}</span>` : ''}
      </div>
      ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}
    </div>
  </a>
</article>`
}

/** 首页 Hero 卡片内容（锚点 index.astro 的 div[data-sync-block="heroCard"]） */

export function renderHeroCard(
  hero: { greeting: string; name: string; subtitle: string; bio: string },
  socials: Array<{ href: string; icon: string; label: string }>,
): string {
  const socialHtml = socials
    .map((item) => {
      const link = safeHref(item.href, '#')
      // 认不出图标 → 平台名纯文字胶囊（与 index.astro 的条件渲染保持一致）
      const known = hasIcon(item.icon)
      const inner = known ? iconSvg(item.icon) : escapeHtml(item.label)
      const cls = known ? 'icon-button' : 'icon-button icon-button--label'
      return `<a class="${cls}" href="${escapeAttr(link)}" ${
        link.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''
      } aria-label="${escapeAttr(item.label)}">${inner}</a>`
    })
    .join('')

  // 每一项都只在后台真有内容时输出：结构对齐 index.astro 的条件渲染；
  // 「浏览文章」按钮固定写死（原按钮文字字段已按用户要求删除）
  const titleHtml =
    hero.greeting || hero.name
      ? `<h1 class="hero__title">${escapeHtml(hero.greeting)}<span class="hero__name">${escapeHtml(
          hero.name,
        )}</span>！</h1>`
      : ''
  const actionsHtml = `<div class="hero__actions">
    <a class="hero__tag" href="/archive">浏览文章${iconSvg('arrow-right', 16)}</a>
    ${socials.length > 0 ? `<span class="hero__social" aria-label="社交链接">${socialHtml}</span>` : ''}
  </div>`

  return `<span class="hero__arrow" aria-hidden="true"></span>
  <span class="hero__sticker hero__sticker--1" aria-hidden="true"></span>
  <span class="hero__sticker hero__sticker--2" aria-hidden="true"></span>
  ${titleHtml}
  ${hero.subtitle ? `<p class="hero__subtitle">${escapeHtml(hero.subtitle)}</p>` : ''}
  ${hero.bio ? `<p class="hero__bio">${escapeHtml(hero.bio)}</p>` : ''}
  ${actionsHtml}`
}

/** 首页精选内容（锚点 index.astro 的 aside[data-sync-block="heroPicks"]） */

export function renderHeroPicks(picks: MdEntry[]): string {
  if (picks.length === 0) return ''
  const first = picks[0]
  // hero 大图是 LCP 元素（fetchpriority=high）：Supabase 原图 → 800px webp 变换（实测 286KB→29KB）
  const cover = supabaseImageTransform(getPostCover(first), { width: 800, quality: 72 })
  const category = getPostCategory(first)
  const date = toDate(first.data.date)
  const thumb = cover
    ? `<span class="pick-hero__thumb"><img src="${escapeAttr(cover)}" alt="${escapeAttr(first.data.coverAlt ?? '')}" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" /></span>`
    : `<span class="pick-hero__thumb pick__thumb--fallback" style="--h:${coverHue(String(first.data.title))}"></span>`

  const side = picks
    .slice(1, 5)
    .map((post) => {
      // 侧栏小图显示 132px：400px webp 足够（2x 高清屏）
      const c = supabaseImageTransform(getPostCover(post), { width: 400, quality: 72 })
      const d = toDate(post.data.date)
      const t = c
        ? `<span class="pick-side__thumb"><img src="${escapeAttr(c)}" alt="${escapeAttr(post.data.coverAlt ?? '')}" loading="lazy" referrerpolicy="no-referrer" /></span>`
        : `<span class="pick-side__thumb pick__thumb--fallback" style="--h:${coverHue(String(post.data.title))}"></span>`
      return `<li>
  <a class="pick-side__item" href="${escapeAttr(getPostPath(post))}">
    ${t}
    <span class="pick-side__text">
      <span class="pick-side__title">${escapeHtml(post.data.title)}</span>
      ${d ? `<time class="pick-side__date" datetime="${d.toISOString()}">${formatDate(d)}</time>` : ''}
    </span>
  </a>
</li>`
    })
    .join('')

  return `<p class="hero__picks-label">精选</p>
  <div class="picks">
    <a class="pick-hero" href="${escapeAttr(getPostPath(first))}">
      ${thumb}
      <span class="post-meta">
        ${category ? `<span>${escapeHtml(category)}</span>` : ''}
        ${date ? `<time datetime="${date.toISOString()}">${formatDate(date)}</time>` : ''}
      </span>
      <span class="pick-hero__title">${escapeHtml(first.data.title)}</span>
      <span class="pick-hero__desc">${escapeHtml(getPostDescription(first))}</span>
    </a>
    ${picks.length > 1 ? `<ul class="pick-side">${side}</ul>` : ''}
  </div>`
}

/** 导航链接（Nav.astro 中 .site-nav__tags 的动态链接部分） */

export function renderNavLinks(
  navItems: Array<{ href: string; label: string; external?: boolean }>,
  pathname: string,
): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  const isCurrent = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))

  return navItems
    .map((item) => {
      const href = safeHref(item.href, '#')
      // 外链新标签打开：与 Nav.astro 的静态渲染保持逐字一致，否则同步注入会改变链接行为
      const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a href="${escapeAttr(href)}" class="site-nav__tag${isCurrent(href) ? ' is-current' : ''}" data-nav-route${ext}>${escapeHtml(item.label)}</a>`
    })
    .join('')
}

/**
 * 「更多」下拉面板条目（Nav.astro 中 .site-more__grid 的内容）。
 *
 * 与 Nav.astro 静态渲染逐字对齐，否则同步注入一次面板结构就变：
 *  - 有 href → 渲染 <a>，外链加 target/rel，图标缺失时给占位 span
 *  - 无 href → 渲染不可点的 is-disabled 占位（后台先填标题、页面后建的情形）
 */

export function renderMorePanel(
  items: Array<{ href: string; label: string; icon?: string; external?: boolean }>,
): string {
  return items
    .map((item) => {
      const icon = item.icon && hasIcon(item.icon) ? iconSvg(item.icon, 20) : ''
      const iconBlock = icon
        ? `<span class="site-more__icon" aria-hidden="true">${icon}</span>`
        : '<span class="site-more__icon site-more__icon--placeholder" aria-hidden="true"></span>'

      if (!item.href) {
        return `<li><span class="site-more__item is-disabled" aria-disabled="true">${iconBlock}<span class="site-more__label">${escapeHtml(item.label)}</span></span></li>`
      }

      const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<li><a class="site-more__item" href="${escapeAttr(safeHref(item.href, '#'))}" data-more-link${ext}>${iconBlock}<span class="site-more__label">${escapeHtml(item.label)}</span></a></li>`
    })
    .join('')
}

/** ICP 备案号：后台留空则整块不渲染（与 Footer.astro 的守卫一致） */

export function renderSiteAge(settings: SyncData['settings'] | null | undefined): string {
  const since = String(settings?.siteCreatedAt ?? '').trim()
  const age = siteAge(since)
  if (!age) return ''
  return `<section class="site-age" data-site-age data-since="${escapeAttr(since)}">
    <div class="site-age__card">
      <header class="site-age__head">
        ${iconSvg('clock', 15)}
        <h2>站点运行时间</h2>
      </header>
      <div class="site-age__figure">
        ${iconSvg('clock', 30, 'site-age__glyph')}
        <p class="site-age__count">
          <span class="site-age__num" data-age="totalDays">${age.totalDays}</span>
          <span class="site-age__unit">天</span>
        </p>
      </div>
      <ul class="site-age__chips" aria-label="运行时长拆分">
        <li class="site-age__chip site-age__chip--yellow"><b data-age="years">${age.years}</b>年</li>
        <li class="site-age__chip site-age__chip--cyan"><b data-age="months">${age.months}</b>月</li>
        <li class="site-age__chip site-age__chip--green"><b data-age="days">${age.days}</b>天</li>
      </ul>
    </div>
  </section>`
}

/**
 * 页脚两个区块（footerInner / footerBar）的统一组装：
 * 作者、ICP、头像、版权年、底栏声明都从同一份 settings 取值，避免各页面 blocks 重复展开。
 */

export function footerBlocks(settings: SyncData['settings'] | null | undefined): {
  footerInner: string
  footerBar: string
} {
  const doc = settings ?? null
  return {
    footerInner: renderFooterInner(
      getFooterData(doc),
      settings?.siteAuthor ?? site.author,
      icpOf(settings),
      avatarOf(settings),
    ),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, currentYearShanghai()),
  }
}

/** 页脚主体内容（锚点Footer.astro 的 div[data-sync-block="footerInner"]） */

export function renderFooterInner(
  footer: {
    subtitle: string
    channels: Array<{ name: string; icon: string; href: string }>
    groups: Array<{ name: string; icon: string; href: string }>
  },
  author: string,
  icp = '',
  avatarSrc = '/avatars/avatar.png',
): string {
  // 图标表里没有的名字不渲染空 svg，只留文字（与 Footer.astro 的条件渲染一致）
  const glyph = (name: string) => (hasIcon(name) ? iconSvg(name, 15) : '')
  const link = (item: { name: string; icon: string; href: string }, plain = false) => {
    // 与前台 site-settings.ts 一致：协议不合法的链接退化成空串（群组据此渲染成纯文字标签）
    const href = safeHref(item.href, '')
    return plain
      ? `<span class="site-footer__item">${glyph(item.icon)}${escapeHtml(item.name)}</span>`
      : `<a href="${escapeAttr(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${glyph(item.icon)}${escapeHtml(item.name)}</a>`
  }

  const channelsHtml = footer.channels.map((c) => (safeHref(c.href, '') ? link(c) : link(c, true))).join('')
  const groupsHtml = footer.groups.map((g) => (safeHref(g.href, '') ? link(g) : link(g, true))).join('')
  // 分隔点只在真有群组时出现：与 Footer.astro 的 `groups.length > 0 &&` 守卫保持一致，
  // 否则后台清空群组后页脚会留一个孤零零的「·」
  const groupsSection =
    footer.groups.length > 0 ? `<span class="site-footer__sep" aria-hidden="true"></span>${groupsHtml}` : ''
  // 后台把链接和群组都清空时，整个 nav 不出（与 Footer.astro 一致），避免空容器撑出间距
  const hasLinks = footer.channels.length > 0 || footer.groups.length > 0

  return `<div class="site-footer__id">
    <img src="${escapeAttr(avatarSrc)}" alt="${escapeAttr(author)}" class="site-footer__avatar" width="40" height="40" />
    <div class="site-footer__id-text">
      <strong>${escapeHtml(author)}</strong>
      ${footer.subtitle ? `<span>${escapeHtml(footer.subtitle)}</span>` : ''}
    </div>
    ${icp ? `<a class="site-footer__icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer nofollow">${iconSvg('shield', 14)}${escapeHtml(icp)}</a>` : ''}
  </div>
  ${
    hasLinks
      ? `<nav class="site-footer__links" aria-label="页脚链接">
    ${channelsHtml}
    ${groupsSection}
  </nav>`
      : ''
  }`
}

/**
 * 页脚底栏内容（锚点 Footer.astro 的 div[data-sync-block="footerBar"]）；
 * 声明文字字段已按用户要求删除，仅留版权行 + 隐私政策 / 发展历程入口。
 *
 * ⚠️ 这两个链接都是**固定**的（/privacy、/timeline 都是 Astro 静态页，不来自后台数据），
 * 但底栏整块由同步覆盖，所以这里必须跟着 Footer.astro 一起输出，
 * 否则后台一同步这两条链接就会消失。
 */

export function renderFooterBar(author: string, year: number): string {
  return `<span>© ${year} ${escapeHtml(author)}</span>
    <a class="site-footer__legal" href="/privacy">隐私政策</a>
    <a class="site-footer__legal" href="/timeline">发展历程</a>`
}

/** 文章详情头部内容（锚点 posts/[...slug].astro 的 header[data-sync-block="articleHeader"]）
 *  注意：详情页不渲染封面图（原先的两处 cover 判断口径不一，会叠出两张同款图）；
 *  封面只用于列表卡片、OG 分享图与 JSON-LD 的 image。 */

export function renderPostList(posts: MdEntry[], compact = false): string {
  return posts.map((p) => renderPostSummary(p, { compact })).join('')
}

// ---------------------------------------------------------------------------
// 随笔页（notes.astro）
// ---------------------------------------------------------------------------

export async function homeBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const { posts, settings } = ctx
  const sorted = sortPosts(posts)
  const featured = sorted.filter((p) => Number(p.data.sticky ?? 0) > 0)
  // 与前台 index.astro 保持一致：latestPosts 输出**全量**，
  // 分批展开由页内脚本完成（前台 PAGE=5）。这里若再 slice(0, 8)，
  // 后台同步一次就会把首页列表打回 8 条，与构建产物对不上。
  const latest = sortPostsByDate(sorted)
  const heroPicks = [...featured, ...latest.filter((p) => !featured.some((f) => f.id === p.id))].slice(0, 5)

  const hero = getHeroData(settings)
  const socials = getSocials(settings)
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    heroCard: renderHeroCard(hero, socials),
    heroPicks: renderHeroPicks(heroPicks),
    latestPosts: latest.map((p) => renderPostSummary(p)).join(''),
    heroCount: `全部 ${posts.length} 篇`,
    siteAge: renderSiteAge(settings),
  }
}

/** 文章详情页：URL 形如 /posts/{分类标识}/{数字ID}，按数字 ID 精确匹配（分类段不参与匹配） */
