/**
 * 博客前台数据同步 —— 服务端渲染层
 *
 * 功能：把 Payload 最新数据渲染为与 Astro 静态构建**完全一致**的 HTML 区块。
 * 两个消费方：
 *   1. /api/blog-sync → 前台客户端轮询/SSE 后用 innerHTML 局部替换；
 *   2. [[...path]]/route.ts → 响应 HTML 前直接注入，保证首屏就是最新数据（不闪烁）。
 *
 * 说明：所有动态文本都经过 escapeHtml 转义，避免 XSS 与结构破坏。
 *
 * ⚠️ 区块约定：**每个区块返回的都是锚点元素的 innerHTML**，
 *    即 <div class="hero__card" data-sync-block="heroCard">…这里…</div>
 *    渲染函数不再自带这一层容器，否则每同步一次就会多套一层同名容器（双层内边距/边框）。
 *    内层结构与对应 *.astro 模板保持一致，class 名一致以保证样式不变。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { createHighlighter } from 'shiki'

// 项目 markdown 插件（跨 app 复用同一份实现，保证短代码/图片处理与构建时一致）
import remarkLegacyShortcodes from 'cloud-blog/shared/remark-legacy-shortcodes.mjs'
import rehypeLegacyShortcodes from 'cloud-blog/shared/rehype-legacy-shortcodes.mjs'
import { createRehypeImgAttrs } from 'cloud-blog/shared/rehype-img-attrs.mjs'
// href 协议白名单 + 关于页正文净化：与前台共用同一份实现（escapeAttr 只挡引号，挡不住 javascript:）
import { safeHref } from 'cloud-blog/shared/html-safety'
import {
  parseNotes,
  parseSkills,
  resolveAboutColor,
  splitAboutParagraphs,
  type NoteItem,
  type SkillItem,
} from 'cloud-blog/shared/about-format'
// 正文净化白名单：与 Astro 构建链共用同一份 schema（默认值来自本 app 依赖，shared 层不带裸包 import）
import { buildMdSanitizeSchema } from 'cloud-blog/shared/md-sanitize-schema.mjs'
// 站点内容的离线兜底：与前台 Astro 层同一份，只有后台整体不可用（settings 为 null）才取用
import {
  footerIconFor,
  OFFLINE_ABOUT,
  OFFLINE_FOOTER,
  OFFLINE_HERO,
  OFFLINE_SOCIALS,
  socialIconFor,
} from 'cloud-blog/shared/site-defaults'
// 站点运行时间（stats 页兜底行用）：与前台同一份算法
import { siteAge } from 'cloud-blog/shared/site-age'
// 站点统计聚合（stats 页卡片/标签数用）：与前台同一份实现
import { buildSiteStats } from 'cloud-blog/shared/site-stats'
// 图标唯一一张表：与 Astro 的 Icon.astro 同一份，品牌图形带官方色
import {
  BRAND_ICONS,
  brandRenderSize,
  brandTransform,
  hasIcon,
  iconInnerMarkup,
  isBrandIcon,
} from 'cloud-blog/shared/icon-paths'

const mdSanitizeSchema = buildMdSanitizeSchema(defaultSchema)

import {
  type MdEntry,
  type ProjectEntry,
  getSyncData,
} from './blog-sync'
import { getBlock, setBlock } from './sync-cache'
// 文章元数据/分类标签/日期处理：与前台博客共用同一份实现（消除两侧重复逻辑）
import {
  formatDate,
  sortPosts,
  sortPostsByDate,
  getPostDescription,
  getPostExcerpt,
  getPostCategory,
  getPostTags,
  getPostCover,
  getReadingMinutes,
  getAdjacentPosts,
  getRelatedPosts,
  getCategories,
  getTags,
  getCategoryPath,
  getTagPath,
  getPostsByCategory,
  getPostsByTag,
  ARCHIVE_PAGE_SIZE,
  getArchivePagePath,
  getArchivePageNumbers,
  getArchivePageYears,
  getArchiveTotalPages,
  parseArchivePage,
  toShanghaiParts,
} from 'cloud-blog/shared/post-utils'

// 站点默认值（后台 SiteSettings 缺失时兜底）。原 site.config.json 已移除，统一在此维护。
const SITE_DEFAULTS = {
  name: '云岫的博客',
  description: '记录 AI、代码、剪辑和生活观察。',
  url: process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://example.com',
  author: '小冷',
}

const site = { ...SITE_DEFAULTS }

/** 从 post 上取分类名（data.categories 已归一为字符串数组，取第一个） */
const postCategoryName = (post: MdEntry): string => {
  const cats = post.data?.categories
  if (Array.isArray(cats) && cats.length > 0) return String(cats[0])
  return 'uncategorized'
}

/** 文章详情页路径：/posts/{分类名}/{数字ID}/ */
const getPostPath = (post: MdEntry) =>
  `/posts/${encodeURIComponent(postCategoryName(post))}/${String(post.id)}/`

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** HTML 转义（用于所有动态文本） */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 属性值转义（用于 class 等） */
const escapeAttr = escapeHtml

const toDate = (value?: unknown): Date | undefined =>
  value ? new Date(String(value)) : undefined

/** 当前年份（Asia/Shanghai），与前台 Astro 模板同口径，避免运行机 TZ 造成跨年一天错位 */
const currentYearShanghai = () => Number(toShanghaiParts(new Date())?.year)

// ---------------------------------------------------------------------------
// 站点设置 / Hero / 社交 / 页脚（与前台 site-settings.ts 逻辑一致）
// ---------------------------------------------------------------------------

function parseSocials(raw?: string): Array<{ platform: string; href: string }> {
  if (!raw) return []
  const out: Array<{ platform: string; href: string }> = []
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.indexOf(' ')
    if (sp === -1) continue
    out.push({ platform: trimmed.slice(0, sp).trim(), href: trimmed.slice(sp + 1).trim() })
  }
  return out
}

/**
 * Hero / 社交 / 页脚 / 关于的取值规则与前台 site-settings.ts 完全一致：
 * 后台可用时原样返回（字段留空就是空串/空数组，由渲染层省略该项），
 * 仅当后台整体不可用（settings === null）才使用 shared/site-defaults 的离线兜底。
 */
function getHeroData(settings: Record<string, any> | null) {
  if (settings === null) return { ...OFFLINE_HERO }
  return {
    greeting: settings.greeting ?? '',
    name: settings.name ?? '',
    subtitle: settings.subtitle ?? '',
    bio: settings.bio ?? '',
  }
}

function getSocials(settings: Record<string, any> | null) {
  const items =
    settings === null
      ? OFFLINE_SOCIALS
      : parseSocials(settings.socials).map((item) => ({ ...item, label: item.platform }))
  // 与页脚同规则：认不出图标的平台照样显示，只是没有图形
  return items
    .map((item) => ({ ...item, icon: socialIconFor(item.platform) }))
    .filter((item) => item.href)
}

function getFooterData(settings: Record<string, any> | null) {
  const parseFooterLines = (raw?: string | null) => {
    if (!raw) return []
    const out: Array<{ name: string; icon: string; href: string }> = []
    for (const line of String(raw).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const sp = trimmed.lastIndexOf(' ')
      if (sp === -1) {
        out.push({ name: trimmed, icon: footerIconFor(trimmed), href: '' })
        continue
      }
      const name = trimmed.slice(0, sp).trim()
      const href = trimmed.slice(sp + 1).trim()
      if (name) out.push({ name, icon: footerIconFor(name), href })
    }
    return out
  }

  if (settings === null) {
    return {
      subtitle: OFFLINE_FOOTER.subtitle,
      channels: OFFLINE_FOOTER.channels,
      groups: OFFLINE_FOOTER.groups,
    }
  }
  return {
    subtitle: settings.footerSubtitle ?? '',
    channels: parseFooterLines(settings.footerChannels),
    groups: parseFooterLines(settings.footerGroups),
  }
}

/** 精选封面占位色的色相（与 index.astro coverHue 一致） */
function coverHue(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return 12 + (hash % 32)
}

// ---------------------------------------------------------------------------
// 图标渲染：与 Astro 的 Icon.astro 共用 shared/icon-paths 同一张表
// （以前两侧各抄一份，这份少了 archive / compass / spark / bookmark / mail 五个，
//   于是后台同步回来的区块里那几个图标会变成空白）
// ---------------------------------------------------------------------------

function iconSvg(name: string, size = 20, className?: string, strokeWidth = 1.75): string {
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
// Markdown 渲染（与 Astro 构建管线一致：插件顺序 + shiki github-dark 高亮）
// ---------------------------------------------------------------------------

const SHIKI_LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'html', 'css', 'scss', 'json',
  'bash', 'sh', 'shell', 'python', 'sql', 'markdown', 'yaml', 'xml', 'diff',
  'go', 'rust', 'java', 'c', 'cpp', 'dockerfile', 'makefile', 'graphql', 'plaintext',
]

let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: SHIKI_LANGS,
    }).catch((err) => {
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

/** 反转 HTML 实体（用于把转义后的代码块文本还原为源码给 shiki） */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 用 shiki 高亮代码块，输出与 Astro 构建一致的 astro-code 结构 */
async function highlightCodeBlocks(html: string): Promise<string> {
  const highlighter = await getHighlighter()
  if (!highlighter) return html
  const pattern = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g
  let match
  let out = ''
  let lastIndex = 0
  while ((match = pattern.exec(html)) !== null) {
    out += html.slice(lastIndex, match.index)
    const lang = match[1]
    const text = decodeHtmlEntities(match[2])
    const loaded = highlighter.getLoadedLanguages() as string[]
    const actualLang = loaded.includes(lang) ? lang : 'plaintext'
    const highlighted = highlighter.codeToHtml(text, {
      lang: actualLang,
      theme: 'github-dark',
    })
    out += highlighted.replace(
      /^<pre[^>]*>/,
      `<pre class="astro-code github-dark" style="background-color:#24292e;color:#e1e4e8; overflow-x: auto;" tabindex="0" data-language="${actualLang}">`,
    )
    lastIndex = match.index + match[0].length
  }
  out += html.slice(lastIndex)
  return out
}

/** github-slugger 兼容的标题 slug（与 Astro 构建时的锚点 id 一致） */
function createSlugger() {
  const seen = new Map<string, number>()
  return (text: string) => {
    let slug = String(text).toLowerCase().trim()
    // 去掉常见标点（保留中文、字母、数字、连字符）
    slug = slug.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/g, '')
    slug = slug.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug) slug = 'heading'
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count > 0 ? `${slug}-${count}` : slug
  }
}

interface Heading {
  depth: number
  text: string
  slug: string
}

/**
 * 渲染 markdown 为 HTML，返回正文与标题列表（用于目录）。
 * @param md 原始 markdown 文本
 * @param altMap 图片 url → alt 文本映射，用于给正文里的 `![](url)` 补齐 alt（SEO/无障碍）
 */
async function renderMarkdown(md: string, altMap: Map<string, string>): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = []
  const slugger = createSlugger()

  const collectHeadings = (tree: any) => {
    const visit = (node: any) => {
      if (node?.type === 'element' && /^h[23]$/.test(node.tagName)) {
        const text =
          node.children?.map((c: any) => (c?.type === 'text' ? c.value : '')).join('') ?? ''
        const slug = slugger(text)
        node.properties = node.properties ?? {}
        node.properties.id = slug
        headings.push({ depth: Number(node.tagName[1]), text, slug })
      }
      if (Array.isArray(node?.children)) node.children.forEach(visit)
    }
    visit(tree)
  }

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLegacyShortcodes)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeLegacyShortcodes)
    .use(rehypeRaw)
    .use(rehypeSanitize, mdSanitizeSchema)
    .use(createRehypeImgAttrs(altMap))
    .use(() => collectHeadings)
    .use(rehypeStringify)
    .process(md)

  const html = await highlightCodeBlocks(String(file))
  return { html, headings }
}

// ---------------------------------------------------------------------------
// 区块渲染（与各 .astro 模板结构一一对应）
// ---------------------------------------------------------------------------

/** PostSummary.astro */
function renderPostSummary(
  post: MdEntry,
  opts: { hideYear?: boolean; compact?: boolean } = {},
): string {
  const { hideYear = false, compact = false } = opts
  const date = toDate(post.data.date)
  const parts = toShanghaiParts(date)
  const monthDay = parts ? `${parts.month}·${parts.day}` : ''
  const excerpt = compact ? undefined : getPostExcerpt(post)
  const category = getPostCategory(post)

  const classList = ['post-row', compact && 'post-row--compact', !date && 'post-row--plain']
    .filter(Boolean)
    .join(' ')

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
function renderHeroCard(
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
    <a class="hero__tag" href="/archive/">浏览文章${iconSvg('arrow-right', 16)}</a>
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
function renderHeroPicks(picks: MdEntry[]): string {
  if (picks.length === 0) return ''
  const first = picks[0]
  const cover = getPostCover(first)
  const category = getPostCategory(first)
  const date = toDate(first.data.date)
  const thumb = cover
    ? `<span class="pick-hero__thumb"><img src="${escapeAttr(cover)}" alt="${escapeAttr(first.data.coverAlt ?? '')}" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" /></span>`
    : `<span class="pick-hero__thumb pick__thumb--fallback" style="--h:${coverHue(String(first.data.title))}"></span>`

  const side = picks.slice(1, 5).map((post) => {
    const c = getPostCover(post)
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
  }).join('')

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
function renderNavLinks(
  navItems: Array<{ href: string; label: string }>,
  pathname: string,
): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  const isCurrent = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href)

  return navItems
    .map((item) => {
      const href = safeHref(item.href, '#')
      return `<a href="${escapeAttr(href)}" class="site-nav__tag${isCurrent(href) ? ' is-current' : ''}" data-nav-route>${escapeHtml(item.label)}</a>`
    })
    .join('')
}

/** ICP 备案号：后台留空则整块不渲染（与 Footer.astro 的守卫一致） */
function icpOf(settings: SyncData['settings'] | null | undefined): string {
  return settings?.siteIcp?.trim() ?? ''
}

/** 页脚头像：后台「网站图标」优先，留空/不合法用站点默认头像（与 Footer.astro 一致） */
function avatarOf(settings: SyncData['settings'] | null | undefined): string {
  return safeHref(settings?.siteIcon, '/avatars/avatar.png')
}

/**
 * 首页「站点运行时间」卡（锚点 index.astro 的 aside[data-sync-block="siteAge"]）。
 * 后台「网站创建时间」留空 → 返回 ''（清空区块，全站「填了才显示」一致）；
 * 数字按注入时刻算，页面脚本（SiteAge.astro）进页面后会用同一套算法再重算一遍。
 * 标记必须与 SiteAge.astro 的产物逐字一致，否则块替换会出现两套样式/结构。
 */
function renderSiteAge(settings: SyncData['settings'] | null | undefined): string {
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
function footerBlocks(settings: SyncData['settings'] | null | undefined): {
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
function renderFooterInner(
  footer: { subtitle: string; channels: Array<{ name: string; icon: string; href: string }>; groups: Array<{ name: string; icon: string; href: string }> },
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

  const channelsHtml = footer.channels
    .map((c) => (safeHref(c.href, '') ? link(c) : link(c, true)))
    .join('')
  const groupsHtml = footer.groups.map((g) => (safeHref(g.href, '') ? link(g) : link(g, true))).join('')
  // 分隔点只在真有群组时出现：与 Footer.astro 的 `groups.length > 0 &&` 守卫保持一致，
  // 否则后台清空群组后页脚会留一个孤零零的「·」
  const groupsSection =
    footer.groups.length > 0
      ? `<span class="site-footer__sep" aria-hidden="true"></span>${groupsHtml}`
      : ''
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

/** 页脚底栏内容（锚点 Footer.astro 的 div[data-sync-block="footerBar"]）；声明文字字段已按用户要求删除，仅留版权行 */
function renderFooterBar(author: string, year: number): string {
  return `<span>© ${year} ${escapeHtml(author)}</span>`
}

/** 文章详情头部内容（锚点 posts/[...slug].astro 的 header[data-sync-block="articleHeader"]） */
function renderArticleHeader(
  post: MdEntry,
  opts: { hasToc: boolean },
): string {
  const category = getPostCategory(post)
  const date = toDate(post.data.date)
  const tags = getPostTags(post)
  const description = getPostDescription(post)
  const cover = getPostCover(post)
  const readingMinutes = getReadingMinutes(post)
  const updated = toDate(post.data.updated)

  const coverHtml =
    cover && !opts.hasToc
      ? `<img class="article__cover" src="${escapeAttr(cover)}" alt="${escapeAttr(post.data.coverAlt ?? '')}" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/covers/default-cover.svg'" />`
      : ''

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
  ${tagHtml}
  ${coverHtml}`
}

/** 文章正文内容（锚点 posts/[...slug].astro 的 div[data-sync-block="postContent"]） */
async function renderArticleContent(post: MdEntry, altMap: Map<string, string>): Promise<string> {
  const { html } = await renderMarkdown(post.body, altMap)
  return html
}

/** 文章侧栏目录内容（锚点 posts/[...slug].astro 的 aside[data-sync-block="tocSidebar"]） */
function renderTocSidebar(tocGroups: Array<{ slug: string; text: string; children: Array<{ slug: string; text: string }> }>): string {
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
</li>`
    )
    .join('')
  return `<nav class="toc" aria-labelledby="toc-heading">
    <h2 id="toc-heading">目录</h2>
    <ol>${items}</ol>
  </nav>`
}

/** 文章页脚内容（锚点 posts/[...slug].astro 的 footer[data-sync-block="articleFooter"]） */
function renderArticleFooter(
  newer: MdEntry | undefined,
  older: MdEntry | undefined,
  related: MdEntry[],
): string {
  const navHtml =
    newer || older
      ? `<nav class="post-nav" aria-label="相邻文章">
      ${
        older
          ? `<a class="post-nav__prev" href="${escapeAttr(getPostPath(older))}"><span>上一篇</span><strong>${escapeHtml(older.data.title)}</strong></a>`
          : ''
      }
      ${
        newer
          ? `<a class="post-nav__next" href="${escapeAttr(getPostPath(newer))}"><span>下一篇</span><strong>${escapeHtml(newer.data.title)}</strong></a>`
          : ''
      }
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

  return `${navHtml}
  ${relatedHtml}`
}

/** 归档页 header（分页时补上页码信息，与 archive/[page].astro 的文案保持一致） */
function renderArchiveHeader(count: number, page: number, totalPages: number): string {
  const rangeLabel =
    count === 0
      ? '暂无文章'
      : `${(page - 1) * ARCHIVE_PAGE_SIZE + 1} - ${Math.min(page * ARCHIVE_PAGE_SIZE, count)}`
  const meta =
    totalPages > 1 ? `<p class="archive-page__meta">第 ${page} / ${totalPages} 页 · 本页 ${rangeLabel} 篇</p>` : ''
  return `<p class="eyebrow">Archive</p>
  <h1>文章归档</h1>
  <p>目前收录 ${count} 篇文章，可以按时间、分类或标签浏览。</p>
  ${meta}`
}

/** 归档页分类/标签索引面板内容（锚点 archive.astro 的 section[data-sync-block="archiveSummary"]） */
function renderArchiveSummary(
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
function renderArchiveYears(
  years: Array<{ year: string; posts: MdEntry[]; yearCount: number }>,
): string {
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
function renderTermSwitcher(
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
function renderPostList(posts: MdEntry[], compact = false): string {
  return posts.map((p) => renderPostSummary(p, { compact })).join('')
}

// ---------------------------------------------------------------------------
// 随笔页（notes.astro）
// ---------------------------------------------------------------------------

const MOOD: Record<string, string> = {
  晴: 'sun', 晴天: 'sun', sunny: 'sun', clear: 'sun',
  阴: 'cloud', 阴天: 'cloud', cloudy: 'cloud', overcast: 'cloud',
  多云: 'cloud', partlycloudy: 'cloud',
  雨: 'cloud-drizzle', 下雨: 'cloud-drizzle', 小雨: 'cloud-drizzle', rain: 'cloud-drizzle', rainy: 'cloud-drizzle',
  大雨: 'cloud-rain', 暴雨: 'cloud-rain', storm: 'cloud-rain', heavyrain: 'cloud-rain',
  雷: 'cloud-lightning', 雷雨: 'cloud-lightning', thunder: 'cloud-lightning',
  雪: 'cloud-snow', 下雪: 'cloud-snow', snow: 'cloud-snow', snowy: 'cloud-snow',
  风: 'wind', 大风: 'wind', windy: 'wind', wind: 'wind',
  雾: 'fog', fog: 'fog', foggy: 'fog',
  夜: 'moon', 夜晚: 'moon', 晚上: 'moon', night: 'moon',
  开心: 'smile', 高兴: 'smile', 快乐: 'smile', happy: 'smile',
  平静: 'meh', 平和: 'meh', 还好: 'meh', calm: 'meh',
  难过: 'frown', 伤心: 'frown', emo: 'frown', sad: 'frown',
  累: 'tired', 疲惫: 'tired', 困: 'tired', tired: 'tired',
  爱: 'heart', 喜欢: 'heart', love: 'heart',
  思考: 'idea', 想法: 'idea', thinking: 'idea', idea: 'idea',
}

function moodIcon(mood?: string): string | undefined {
  if (!mood) return undefined
  const raw = mood.trim()
  return MOOD[raw] ?? MOOD[raw.toLowerCase().replace(/[\s-]/g, '')]
}

/** 渲染单条随笔（note__meta + note__main + markdown 正文） */
async function renderNote(note: MdEntry, altMap: Map<string, string>, anchor?: string): Promise<string> {
  const date = toDate(note.data.date)
  const { html } = await renderMarkdown(note.body, altMap)
  const mood = moodIcon(note.data.mood)

  const moodHtml = note.data.mood
    ? mood
      ? `<span class="note__mood">${iconSvg(mood, 15)}<span class="note__mood-text">${escapeHtml(note.data.mood)}</span></span>`
      : `<span class="note__mood note__mood-text">${escapeHtml(note.data.mood)}</span>`
    : ''

  const tagsHtml =
    note.data.tags && note.data.tags.length > 0
      ? `<div class="tag-list note__tags" aria-label="标签">${note.data.tags.map((t: string) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
      : ''

  return `<article class="note"${anchor ? ` id="${anchor}"` : ''}>
  <div class="note__meta">
    ${date ? `<time datetime="${date.toISOString()}">${formatDate(date)}</time>` : ''}
    ${moodHtml}
  </div>
  <div class="note__main">
    ${note.data.title ? `<h3 class="note__title">${escapeHtml(note.data.title)}</h3>` : ''}
    <div class="note__body post-content">${html}</div>
    ${tagsHtml}
  </div>
</article>`
}

/** 随笔页 feed 内容（锚点 notes.astro 的 div[data-sync-block="notesFeed"]）与
/**
 * 随笔月份锚点：按日期倒序，每月第一条拿 `t-{年}-{月}`（月份不补零），其余条目没有 id。
 * 与 notes.astro（lib/anchors.ts）同规则；随笔列表页与搜索深链共用（见 buildSiteIndex）。
 */
function noteMonthAnchorIds(notes: MdEntry[]): Map<string, string> {
  const ordered = [...notes].sort(
    (a, b) => (toDate(b.data.date)?.getTime() ?? 0) - (toDate(a.data.date)?.getTime() ?? 0),
  )
  const seenMonth = new Set<string>()
  const anchors = new Map<string, string>()
  for (const note of ordered) {
    const parts = toShanghaiParts(toDate(note.data.date))
    if (!parts) continue
    const key = `${parts.year}-${Number(parts.month)}`
    if (seenMonth.has(key)) continue
    seenMonth.add(key)
    anchors.set(note.id, `t-${key}`)
  }
  return anchors
}

/**
 *  时间索引内容（锚点 aside[data-sync-block="notesAside"]） */
async function renderNotesFeed(notes: MdEntry[], altMap: Map<string, string>): Promise<{
  feed: string
  aside: string
}> {
  const sorted = [...notes].sort(
    (a, b) => (toDate(b.data.date)?.getTime() ?? 0) - (toDate(a.data.date)?.getTime() ?? 0),
  )

  const byYear: { year: string; notes: MdEntry[] }[] = []
  for (const note of sorted) {
    const year = toShanghaiParts(toDate(note.data.date))?.year ?? ''
    const group = byYear.find((g) => g.year === year)
    if (group) group.notes.push(note)
    else byYear.push({ year, notes: [note] })
  }

  const monthAnchor = noteMonthAnchorIds(sorted)

  const timeIndex = byYear.map((group) => ({
    year: group.year,
    months: group.notes
      .filter((n) => monthAnchor.has(n.id))
      .map((n) => ({
        label: `${Number(toShanghaiParts(toDate(n.data.date))!.month)}月`,
        anchor: monthAnchor.get(n.id)!,
      })),
  }))

  const feedParts: string[] = []
  for (const group of byYear) {
    const items: string[] = []
    for (const note of group.notes) {
      items.push(await renderNote(note, altMap, monthAnchor.get(note.id)))
    }
    feedParts.push(
      `<section class="notes-year" id="y-${group.year}"><h2 class="notes-year__label"><span>${group.year}</span></h2>${items.join('')}</section>`,
    )
  }

  const aside =
    byYear.length > 1
      ? `<nav class="toc" aria-labelledby="notes-time-heading">
    <h2 id="notes-time-heading">时间</h2>
    <ol>
      ${timeIndex
        .map(
          (g) => `<li class="notes-index__year">
    <a href="#y-${g.year}">${g.year}</a>
    <div class="notes-index__sub"><ol class="notes-index__months">${g.months
      .map((m) => `<li class="toc__item--depth-3"><a href="#${m.anchor}">${m.label}</a></li>`)
      .join('')}</ol></div>
  </li>`,
        )
        .join('')}
    </ol>
  </nav>`
      : ''

  return { feed: feedParts.join(''), aside }
}

// ---------------------------------------------------------------------------
// 关于页（about.astro）：正文/便签/技能环 + 项目区
// ---------------------------------------------------------------------------

// SkillItem / NoteItem 与解析统一走 shared/about-format（前台同一份实现）
interface AboutData {
  paragraphs: string[]
  notes: NoteItem[]
  skills: SkillItem[]
}

/** 关于页文案：与前台 getAboutContent() 同规则——后台填了才有，宕机才兜底 */
function getAboutData(settings: Record<string, any> | null): AboutData {
  if (settings === null) {
    return {
      paragraphs: OFFLINE_ABOUT.paragraphs,
      notes: OFFLINE_ABOUT.notes,
      skills: OFFLINE_ABOUT.skills,
    }
  }
  return {
    // 正文：==记号== → 高亮 span（整体转义后仅还原记号，比旧 HTML 白名单更严）；
    // 存量 HTML 写法在解析时自动转换，无需迁移数据
    paragraphs: splitAboutParagraphs(settings.aboutParagraphs),
    notes: parseNotes(settings.aboutNotes),
    skills: parseSkills(settings.skills),
  }
}

/** 技能环（与 SkillRing.astro 结构一致）：颜色 token 走主题变量，hex 原样 */
function renderSkillRing(skill: SkillItem): string {
  const ringColor = resolveAboutColor(skill.color) || 'var(--sticky-yellow)'
  const percent = Math.min(100, Math.max(0, skill.value))
  return `<div class="skill-ring">
  <div class="skill-ring__track" aria-hidden="true">
    <div class="skill-ring__fill" style="--ring-color: ${ringColor}; --percent: ${percent}%"></div>
    <span class="skill-ring__value">${percent}%</span>
  </div>
  <div class="skill-ring__text">
    <strong>${escapeHtml(skill.label)}</strong>
    ${skill.sublabel ? `<small>${escapeHtml(skill.sublabel)}</small>` : ''}
  </div>
</div>`
}

/** 关于页顶部内容（锚点 about.astro 的 section[data-sync-block="aboutProfile"]） */
function renderAboutProfile(about: AboutData, postCount: number, firstYear: number): string {
  const paragraphsHtml = about.paragraphs
    .map((p) => `<p class="about__text">${p}</p>`)
    .join('')
  const notesHtml = about.notes
    .map((n) => {
      const color = resolveAboutColor(n.color)
      return `<div class="about__note"${color ? ` style="--note-color: ${escapeAttr(color)}"` : ''}>
    <span class="about__note-tape" aria-hidden="true"></span>
    <strong>${escapeHtml(n.title)}</strong>
    <span>${escapeHtml(n.subtitle)}</span>
  </div>`
    })
    .join('')
  // 「ABOUT / 关于我 / 简介行」按用户要求写死（原字段已删）；结构与 about.astro 逐字对齐
  const introHtml = `<div class="about__intro-card">
    <span class="about__eyebrow">ABOUT</span>
    <h1 id="about-heading" class="about__lead">关于我</h1>
    ${paragraphsHtml}
    <div class="about__facts"><span class="about__fact">${postCount} 篇文章</span><span class="about__fact">写于 ${firstYear} 至今</span><span class="about__fact">全站由 AI 开发</span></div>
  </div>`
  const notesSection =
    about.notes.length > 0 ? `<div class="about__notes">${notesHtml}</div>` : ''

  return `${introHtml}
  ${notesSection}`
}

/** 关于页技能环内容（锚点 about.astro 的 section[data-sync-block="aboutSkills"]） */
function renderAboutSkills(skills: SkillItem[]): string {
  if (skills.length === 0) return ''
  return `<div class="section__header">
    <h2 id="skills-heading">我的小本领</h2>
  </div>
  <div class="skill-grid">${skills.map(renderSkillRing).join('')}</div>`
}

/** 实心星星图标（项目 Star 数） */
const STAR_FILL_SVG =
  '<svg class="proj__stars-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'

interface ProjectGroup {
  title: string
  description: string
  items: ProjectEntry[]
}

/** 把扁平项目列表按 group 聚合，组内按 sortOrder 升序，保留首次出现的分组描述 */
function groupProjects(projects: ProjectEntry[]): ProjectGroup[] {
  const order: string[] = []
  const byGroup = new Map<string, { description: string; items: ProjectEntry[] }>()
  for (const p of projects) {
    if (!byGroup.has(p.group)) {
      byGroup.set(p.group, { description: p.groupDescription ?? '', items: [] })
      order.push(p.group)
    }
    byGroup.get(p.group)!.items.push(p)
  }
  return order.map((title) => {
    const g = byGroup.get(title)!
    return { title, description: g.description, items: g.items }
  })
}

/** 单个项目卡片（about.astro .proj）；「笔记」链接文字写死（原字段已删），有 articleHref 才出 */
function renderProject(item: ProjectEntry): string {
  const starsHtml =
    item.stars > 0
      ? `<span class="proj__stars">${STAR_FILL_SVG}${item.stars}</span>`
      : ''
  const tagsHtml = (item.tags ?? [])
    .map((t) => `<small>${escapeHtml(t)}</small>`)
    .join('')
  // 项目链接同样是后台自由填写：与前台 fetchProjects 用同一套协议白名单
  const articleHref = safeHref(item.articleHref, '')
  const noteHtml =
    articleHref
      ? `<a class="proj__note" href="${escapeAttr(articleHref)}">笔记${iconSvg('arrow-right', 13)}</a>`
      : ''
  const projectHref = safeHref(item.href, '#')
  return `<article class="proj">
  <span class="proj__icon">${iconSvg(item.icon, 18)}</span>
  <div class="proj__body">
    <span class="proj__owner">${escapeHtml(item.owner ?? '')}${starsHtml}</span>
    <h3 class="proj__title">
      <a href="${escapeAttr(projectHref)}"${
        projectHref.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>
        ${escapeHtml(item.title)}${iconSvg('arrow-up-right', 16, 'proj__go')}
      </a>
    </h3>
    <p class="proj__desc">${escapeHtml(item.description ?? '')}</p>
    <div class="proj__foot">
      <span class="proj__tags">${tagsHtml}</span>
      ${noteHtml}
    </div>
  </div>
</article>`
}

/**
 * 分组名 → 合法 HTML id，与 about.astro 的 groupDomId 严格一致：
 * 运行时同步会整块替换 aboutProjects，两侧 id 不同会让 aria-labelledby 指向失效。
 * 纯中文/空格分组名会被 slug 清空，用分组序号兜底保证 id 唯一且非空。
 */
const projectGroupDomId = (title: string, index: number) => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `proj-${index}${slug ? `-${slug}` : ''}`
}

/** 关于页项目区（按分组聚合，与 about.astro 结构一致） */
function renderAboutProjects(projects: ProjectEntry[]): string {
  const groups = groupProjects(projects)
  const sections = groups
    .map(
      (group, index) => group.items.length > 0
        ? `<section class="proj-section" aria-labelledby="${projectGroupDomId(group.title, index)}">
  <div class="proj-section__head">
    <h2 class="proj-section__label" id="${projectGroupDomId(group.title, index)}">${escapeHtml(group.title)}</h2>
    <p class="proj-section__desc">${escapeHtml(group.description)}</p>
  </div>
  <div class="proj-grid">${group.items.map((item) => renderProject(item)).join('')}</div>
</section>`
        : '',
    )
    .join('')
  return sections
}

// ---------------------------------------------------------------------------
// 各页面 blocks 组装
// ---------------------------------------------------------------------------

interface SyncData {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string }>
  /** Media 集合 url → alt 映射，用于正文图片 alt 补齐 */
  mediaAltMap: Map<string, string>
  version: string
}

/** 首页 */
async function homeBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const { posts, settings } = ctx
  const sorted = sortPosts(posts)
  const featured = sorted.filter((p) => Number(p.data.sticky ?? 0) > 0)
  // 与前台 index.astro 保持一致：latestPosts 输出**全量**，
  // 分批展开由页内脚本完成（前台 PAGE=5）。这里若再 slice(0, 8)，
  // 后台同步一次就会把首页列表打回 8 条，与构建产物对不上。
  const latest = sortPostsByDate(sorted)
  const heroPicks = [
    ...featured,
    ...latest.filter((p) => !featured.some((f) => f.id === p.id)),
  ].slice(0, 5)

  const hero = getHeroData(settings)
  const socials = getSocials(settings)
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/'),
    ...footerBlocks(settings),
    heroCard: renderHeroCard(hero, socials),
    heroPicks: renderHeroPicks(heroPicks),
    latestPosts: latest.map((p) => renderPostSummary(p)).join(''),
    heroCount: `全部 ${posts.length} 篇`,
    siteAge: renderSiteAge(settings),
  }
}

/** 文章详情页：URL 形如 /posts/{分类名}/{数字ID}/，按数字 ID 精确匹配 */
async function postBlocks(ctx: SyncData, pathname: string): Promise<Record<string, string | null>> {
  const segs = pathname.split('/')
  // 例：/posts/技术/42/ → ['','posts','技术','42','']
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

  const hasToc = tocGroups.length >= 2
  const { newer, older } = getAdjacentPosts(posts, post)
  const related = getRelatedPosts(posts, post)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, pathname),
    ...footerBlocks(settings),
    // 标题保持原始文本（未转义）：客户端直接赋给 document.title，
    // 服务端注入 <title> 时再统一做一次 HTML 转义。
    pageTitle: `${post.data.title} - ${siteName}`,
    articleHeader: renderArticleHeader(post, { hasToc }),
    postContent: html,
    tocSidebar: hasToc ? renderTocSidebar(tocGroups) : '',
    articleFooter: renderArticleFooter(newer, older, related),
  }
}

/** 归档分页条（锚点 archive/[...page].astro 的 div[data-sync-block="archivePager"]）；单页时返回 '' 清空 */
function renderArchivePager(page: number, totalPages: number): string {
  if (totalPages <= 1) return ''
  const step = (direction: 'prev' | 'next', href: string | null) => {
    const icon = direction === 'prev' ? iconSvg('arrow-left', 16) : iconSvg('arrow-right', 16)
    const inner =
      direction === 'prev'
        ? `${icon}<span>上一页</span>`
        : `<span>下一页</span>${icon}`
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
async function archiveBlocks(ctx: SyncData, path: string): Promise<Record<string, string | null>> {
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
    ...footerBlocks(settings),
    archiveHeader: renderArchiveHeader(posts.length, page, totalPages),
    archiveSummary: renderArchiveSummary(getCategories(posts), getTags(posts)),
    archiveYears: renderArchiveYears(pageYears),
    archivePager: renderArchivePager(page, totalPages),
  }
}

/** 随笔页 */
async function notesBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const settings = ctx.settings
  const { feed, aside } = await renderNotesFeed(ctx.notes, ctx.mediaAltMap)
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/notes/'),
    ...footerBlocks(settings),
    notesFeed: feed,
    notesAside: aside,
  }
}

/** 分类页 / 标签页 */
async function termBlocks(
  ctx: SyncData,
  pathname: string,
  kind: 'categories' | 'tags',
): Promise<Record<string, string | null>> {
  const term = decodeURIComponent(pathname.split('/')[2] ?? '')
  const allPosts = sortPosts(ctx.posts)
  const posts = kind === 'categories'
    ? getPostsByCategory(allPosts, term)
    : getPostsByTag(allPosts, term)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name
  const terms = kind === 'categories' ? getCategories(allPosts) : getTags(allPosts)

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, pathname),
    ...footerBlocks(settings),
    termTitle: escapeHtml(term),
    termSwitcher: renderTermSwitcher(terms, term, kind),
    termPostList: renderPostList(posts, true),
    termCount:
      kind === 'categories'
        ? `这个分类下共有 ${posts.length} 篇文章。`
        : `这个标签下共有 ${posts.length} 篇文章。`,
  }
}

/**
 * 标签墙页（/tags/）：页头（计数为动态数字，仍走同步；静态文案写死）。
 * 注意：/tags/ 必须排在 termBlocks 的 `startsWith('/tags/')` 之前，
 * 否则计数会按「空标签」的 termBlocks 分支渲染出错误内容。
 */
async function tagsIndexBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name
  const tags = buildSiteStats(sortPosts(ctx.posts)).tags

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/tags/'),
    ...footerBlocks(settings),
    tagsHeader: `<div class="tags-hero__top">
    <p class="eyebrow">Tags</p>
    <h1 class="tags-hero__title">标签墙</h1>
  </div>
  <p class="tags-hero__sub">拾取标签，发现更多感兴趣的内容</p>
  <div class="tags-hero__rule" aria-hidden="true"><i></i></div>
  <p class="tags-hero__count">共 <b>${tags.length}</b> 个标签</p>`,
  }
}

/** 统计页（/stats/）：概览卡 + 逐年归档 + 底部更新行（静态文案写死，数字与日期仍走同步） */
async function statsBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const stats = buildSiteStats(posts)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  // 概览卡：与 stats.astro 结构逐字一致（图标 + 数字 + 文案标签）
  const card = (mod: string, iconName: string, value: string, label: string) => `<div class="stats-card stats-card--${mod}">
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
    <a href="/archive/" class="stats-years__more" aria-label="查看 ${escapeHtml(row.year)} 年归档">${iconSvg('arrow-right', 14)}</a>
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
  const latestUpdate = [
    ...posts.map((p) => toDate(p.data.date)),
    ...ctx.notes.map((n) => toDate(n.data.date)),
  ]
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
    navLinks: renderNavLinks(ctx.nav, '/stats/'),
    ...footerBlocks(settings),
    statsCards: [
      card('blue', 'archive', String(stats.postCount), '文章统计'),
      card('yellow', 'spark', stats.wordCount.toLocaleString('zh-CN'), '字数统计'),
      card('green', 'hash', String(stats.tagCount), '标签统计'),
      card('pink', 'layers', String(ctx.notes.length), '随笔统计'),
    ].join('\n    '),
    statsYears: yearsHtml,
    statsSince,
  }
}

/** 关于页 */
async function aboutBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const postCount = posts.length
  const firstYear = posts.reduce((min, post) => {
    const year = Number(toShanghaiParts(toDate(post.data.date))?.year ?? NaN)
    return year && year < min ? year : min
  }, currentYearShanghai())
  const about = getAboutData(ctx.settings)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/about/'),
    ...footerBlocks(settings),
    aboutProfile: renderAboutProfile(about, postCount, firstYear),
    aboutSkills: renderAboutSkills(about.skills),
    aboutProjects: renderAboutProjects(ctx.projects),
  }
}

/**
 * 根据页面路径组装动态区块（/api/blog-sync 的主入口）。
 * pathname 形如 '/'、'/posts/xxx'、'/archive'、'/notes'、'/about'、'/categories/xxx'、'/tags/xxx'。
 *
 * 性能：先取 sync-cache 的数据快照（命中则零查库）；若该 pathname 的区块缓存版本号
 * 与当前一致，直接返回缓存（零渲染）。否则渲染一次并写回区块缓存。afterChange 钩子
 * 会清除缓存，使下一次请求重新渲染最新数据。
 */
/**
 * 历史链接 /posts/{id}/ → 现行规范路径 /posts/{分类名}/{id}/。
 *
 * Astro 静态输出（无 adapter）不会执行 getStaticPaths 里的 redirect，所以旧链接在
 * 构建产物中是一份完整页面；真正的 301 只能由「实际负责返回 HTML 的这一层」来做。
 * @returns 命中旧链接形态时返回规范路径，其余情况返回 null
 */
export async function resolveLegacyPostPath(pathname: string): Promise<string | null> {
  const matched = /^\/posts\/([^/]+)\/?$/.exec(pathname)
  if (!matched) return null
  const id = decodeURIComponent(matched[1])
  // 现行形态是两段（分类名 + ID），单段且全是数字的才可能是旧链接
  if (!/^\d+$/.test(id)) return null
  const snapshot = await getSyncData()
  const post = snapshot.posts.find((entry) => String(entry.id) === id)
  return post ? getPostPath(post) : null
}

// ---------------------------------------------------------------------------
// 站内搜索索引（/site-index.json）：与前台 Astro 端点（apps/blog/src/lib/site-index.ts）同口径。
// 9527/线上由 CMS 动态生成 —— 新发的文章立刻能搜到，不再依赖外壳重建。
// ---------------------------------------------------------------------------

interface SiteIndexEntry {
  kind: 'page' | 'post' | 'note' | 'project' | 'category' | 'tag'
  title: string
  subtitle: string
  meta: string
  url: string
  tags: string[]
  text: string
}

/** 拼小写匹配域：空值直接丢掉，避免多余空格把词切碎（与前台 site-index.ts 同一份规则） */
function matchField(...parts: Array<string | string[] | undefined | null>): string {
  return parts
    .flat()
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase()
}

const stripMarkdown = (value: string) =>
  value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-+]\s+/, '')
    .trim()

/** 随笔大多没有标题，拿正文首行当摘要（与前台同规则） */
function noteFirstLine(body: string): string {
  for (const line of body.split('\n')) {
    const text = stripMarkdown(line)
    if (text) return text.length > 46 ? `${text.slice(0, 46)}…` : text
  }
  return ''
}

/** 导航之外的常驻页面（与前台 site-index.ts 的 EXTRA_PAGES 一致） */
const EXTRA_INDEX_PAGES: Array<{ href: string; label: string; keywords: string }> = [
  { href: '/stats/', label: '统计', keywords: '数据 statistics 归档 标签墙' },
  { href: '/tags/', label: '标签墙', keywords: '标签 tags 分类 cloud 拾取' },
]

export function buildSiteIndex(ctx: {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  nav: Array<{ href: string; label: string }>
}): SiteIndexEntry[] {
  const posts = sortPosts(ctx.posts)

  const pageEntries: SiteIndexEntry[] = [
    ...ctx.nav
      .filter((item) => item.href && item.label)
      .map((item) => ({
        kind: 'page' as const,
        title: item.label,
        subtitle: '',
        meta: '',
        url: item.href,
        tags: [] as string[],
        text: matchField(item.label, item.href),
      })),
    ...EXTRA_INDEX_PAGES.map((item) => ({
      kind: 'page' as const,
      title: item.label,
      subtitle: '',
      meta: '',
      url: item.href,
      tags: [] as string[],
      text: matchField(item.label, item.href, item.keywords),
    })),
  ]

  const postEntries: SiteIndexEntry[] = posts.map((post) => {
    const excerpt = getPostExcerpt(post) ?? ''
    return {
      kind: 'post',
      title: String(post.data.title ?? ''),
      subtitle: excerpt,
      meta: post.data.date ? formatDate(post.data.date) : '',
      url: getPostPath(post),
      tags: getPostTags(post),
      text: matchField(
        post.data.title,
        excerpt,
        getPostCategory(post),
        getPostTags(post),
        post.data.keywords,
      ),
    }
  })

  const noteAnchors = noteMonthAnchorIds(ctx.notes)
  const noteEntries: SiteIndexEntry[] = ctx.notes.map((note) => {
    const title = String(note.data.title ?? '').trim()
    const excerpt = noteFirstLine(note.body ?? '')
    const anchor = noteAnchors.get(note.id)
    return {
      kind: 'note',
      title: title || excerpt || `${formatDate(note.data.date)} 的随笔`,
      subtitle: title ? excerpt : '',
      meta: formatDate(note.data.date),
      url: anchor ? `/notes/#${anchor}` : '/notes/',
      tags: (note.data.tags as string[] | undefined) ?? [],
      text: matchField(note.data.title, excerpt, note.data.mood, note.data.tags),
    }
  })

  const groups = groupProjects(ctx.projects)
  const groupIds = new Map(groups.map((group, index) => [group.title, projectGroupDomId(group.title, index)]))
  const projectEntries: SiteIndexEntry[] = ctx.projects.map((project) => ({
    kind: 'project',
    title: project.title,
    subtitle: project.description ?? '',
    meta: project.group,
    // 项目没有详情页：能跳文章就跳文章，否则落到关于页分组锚点（与前台同规则）
    url: project.articleHref ?? `/about/#${groupIds.get(project.group)}`,
    tags: project.tags ?? [],
    text: matchField(project.title, project.description, project.group, project.owner, project.tags),
  }))

  const termEntries: SiteIndexEntry[] = [
    ...getCategories(posts).map((term) => ({
      kind: 'category' as const,
      title: term.name,
      subtitle: '',
      meta: `${term.count} 篇`,
      url: getCategoryPath(term.name),
      tags: [] as string[],
      text: matchField(term.name),
    })),
    ...getTags(posts).map((term) => ({
      kind: 'tag' as const,
      title: term.name,
      subtitle: '',
      meta: `${term.count} 篇`,
      url: getTagPath(term.name),
      tags: [] as string[],
      text: matchField(term.name),
    })),
  ]

  return [...pageEntries, ...postEntries, ...noteEntries, ...projectEntries, ...termEntries]
}

export async function renderBlocksForPathname(pathname: string): Promise<{
  version: string
  title: string | null
  blocks: Record<string, string | null>
  /** 数据层不存在该页面（文章/分类/标签/归档页码）：外壳缺失的模板兜底据此改判 404 */
  notFound: boolean
  /**
   * 非 DOM 区块的运行时值（页面脚本按需应用，见 BaseLayout 的 applyRuntime）：
   * - icon：站点图标地址（favicon / apple-touch，与页脚头像同一条兜底）
   * - playlist：后台歌单 ID 的「已校验」值；null = 后台留空（前台退回构建期兜底/env），
   *   '' = 明确失效（应隐藏播放器）。非法值不回退 env，与 MusicPlayer 构建期口径一致。
   * 与区块缓存同版本键控：version 变化才重新计算，缓存命中时按同一快照现算（开销可忽略）。
   */
  runtime: { icon: string; playlist: string | null }
}> {
  const snapshot = await getSyncData()
  const version = snapshot.version

  const playlistRaw = String(snapshot.settings?.neteasePlaylistId ?? '').trim()
  const runtime = {
    icon: avatarOf(snapshot.settings),
    playlist: /^\d+$/.test(playlistRaw) ? playlistRaw : playlistRaw ? '' : null,
  }

  // 路径归一化：/about 与 /about/ 视为同一份缓存（服务端注入与前台轮询拿到的 URL 形式可能不同）
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`

  // 命中区块缓存：版本号一致 → 直接返回，零查库、零渲染（~1ms）
  const cached = getBlock(path)
  if (cached && cached.version === version) {
    return { version, title: cached.title, blocks: cached.blocks, notFound: cached.notFound ?? false, runtime }
  }

  const ctx: SyncData = {
    posts: snapshot.posts,
    notes: snapshot.notes,
    projects: snapshot.projects,
    settings: snapshot.settings,
    nav: snapshot.nav,
    mediaAltMap: snapshot.mediaAltMap,
    version,
  }
  const siteName = snapshot.settings?.siteName ?? site.name

  let title: string | null = siteName
  let blocks: Record<string, string | null>
  let notFound = false

  if (path === '/') {
    blocks = await homeBlocks(ctx)
    title = siteName
  } else if (path.startsWith('/posts/')) {
    blocks = await postBlocks(ctx, path)
    title = (blocks.pageTitle as string) ?? siteName
    // postBlocks 查无文章时只返回 { postContent: null }
    notFound = Object.keys(blocks).length === 1 && blocks.postContent === null
  } else if (path === '/notes/') {
    blocks = await notesBlocks(ctx)
    title = `随笔 - ${siteName}`
  } else if (path === '/archive/' || /^\/archive\/\d+\/$/.test(path)) {
    // 归档已分页：/archive/、/archive/2/ … 都要按 path 里的页码切出对应那页
    blocks = await archiveBlocks(ctx, path)
    const page = parseArchivePage(path)
    title = page > 1 ? `归档 - 第 ${page} 页 - ${siteName}` : `归档 - ${siteName}`
    notFound = page < 1 || page > getArchiveTotalPages(ctx.posts.length)
  } else if (path === '/about/') {
    blocks = await aboutBlocks(ctx)
    title = `关于 - ${siteName}`
  } else if (path === '/stats/') {
    blocks = await statsBlocks(ctx)
    title = `数据统计 - ${siteName}`
  } else if (path === '/tags/') {
    // 必须排在 startsWith('/tags/') 之前：否则标签墙页会落进「标签词条页」的分支
    blocks = await tagsIndexBlocks(ctx)
    title = `标签 - ${siteName}`
  } else if (path.startsWith('/categories/')) {
    const term = decodeURIComponent(path.split('/')[2] ?? '')
    blocks = await termBlocks(ctx, path, 'categories')
    title = `分类 - ${siteName}`
    notFound = !getCategories(ctx.posts).some((t) => t.name === term)
  } else if (path.startsWith('/tags/')) {
    const term = decodeURIComponent(path.split('/')[2] ?? '')
    blocks = await termBlocks(ctx, path, 'tags')
    title = `标签 - ${siteName}`
    notFound = !getTags(ctx.posts).some((t) => t.name === term)
  } else {
    blocks = {}
    title = siteName
  }

  setBlock(path, { version, title, blocks, notFound, ts: Date.now() })
  return { version, title, blocks, notFound, runtime }
}
