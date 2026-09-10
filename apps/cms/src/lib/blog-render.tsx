// @ts-nocheck
/**
 * 博客前台数据同步 —— 服务端渲染层
 *
 * 功能：把 Payload 最新数据渲染为与 Astro 静态构建**完全一致**的 HTML 区块，
 * 由 /api/blog-sync 返回给前台客户端，客户端用 innerHTML 局部替换页面内容区，
 * 实现「后台改数据 → 前台自动更新」。
 *
 * 说明：所有动态文本都经过 escapeHtml 转义，避免 XSS 与结构破坏；
 * 区块 HTML 结构与 Astro 模板（*.astro）严格对应，class 名一致以保证样式不变。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { createHighlighter } from 'shiki'

// 项目 markdown 插件（跨 app 复用博客的插件，保证短代码/图片处理与构建时一致）
import remarkLegacyShortcodes from '../../../blog/src/lib/remark-legacy-shortcodes.mjs'
import rehypeLegacyShortcodes from '../../../blog/src/lib/rehype-legacy-shortcodes.mjs'
import rehypeImgAttrs from '../../../blog/src/lib/rehype-img-attrs.mjs'

import siteConfig from '../../../blog/src/data/site.config.json'
import {
  fetchNotes,
  fetchPosts,
  getNavData,
  getSiteSettingsData,
  getDataVersion,
  type MdEntry,
} from './blog-sync'

export const site = {
  name: siteConfig.siteName,
  description: siteConfig.siteDescription,
  url: process.env.NEXT_PUBLIC_SERVER_URL ?? siteConfig.siteUrl ?? 'https://example.com',
  author: siteConfig.siteAuthor,
}

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

/** 与前台一致：yyyy-MM-dd（本地时区） */
export const formatDate = (date?: Date) => {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ---------------------------------------------------------------------------
// 文章工具（与前台 lib/posts.ts 逻辑一致）
// ---------------------------------------------------------------------------

const getTime = (date?: Date) => date?.getTime() ?? 0

export const sortPosts = (posts: MdEntry[]) =>
  [...posts].sort((a, b) => {
    const stickyDiff = (Number(b.data.sticky ?? 0)) - (Number(a.data.sticky ?? 0))
    if (stickyDiff !== 0) return stickyDiff
    const dateDiff = getTime(toDate(b.data.date)) - getTime(toDate(a.data.date))
    if (dateDiff !== 0) return dateDiff
    return String(a.data.title ?? '').localeCompare(String(b.data.title ?? ''), 'zh-CN')
  })

export const sortPostsByDate = (posts: MdEntry[]) =>
  [...posts].sort((a, b) => {
    const dateDiff = getTime(toDate(b.data.date)) - getTime(toDate(a.data.date))
    if (dateDiff !== 0) return dateDiff
    return String(a.data.title ?? '').localeCompare(String(b.data.title ?? ''), 'zh-CN')
  })

export const getPostDescription = (post: MdEntry) =>
  (post.data.description ?? post.data.ai?.[0]) || '技术记录与实践笔记。'

export const getPostExcerpt = (post: MdEntry) =>
  post.data.description ?? post.data.ai?.[0]

export const getPostCategory = (post: MdEntry) => post.data.categories?.[0]

export const getPostTags = (post: MdEntry) => post.data.tags ?? []

export const getPostCover = (post: MdEntry) => post.data.cover

export const getPostPath = (post: MdEntry) => `/posts/${post.id}/`

export const getReadingMinutes = (post: MdEntry) => {
  const body = post.body ?? ''
  const cjkChars = body.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const words = body.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g)?.length ?? 0
  return Math.max(1, Math.ceil((cjkChars + words) / 350))
}

export const getAdjacentPosts = (posts: MdEntry[], current: MdEntry) => {
  const ordered = sortPostsByDate(posts)
  const index = ordered.findIndex((p) => p.id === current.id)
  return {
    newer: index > 0 ? ordered[index - 1] : undefined,
    older: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined,
  }
}

export const getRelatedPosts = (posts: MdEntry[], current: MdEntry, limit = 3) => {
  const currentCategory = getPostCategory(current)
  const currentTags = new Set(getPostTags(current))
  return sortPostsByDate(posts)
    .filter((post) => post.id !== current.id)
    .map((post) => {
      const sharedTags = getPostTags(post).filter((tag) => currentTags.has(tag))
      const sameCategory = currentCategory && getPostCategory(post) === currentCategory ? 1 : 0
      return { post, score: sameCategory * 3 + sharedTags.length }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.post)
}

const countItems = (items: string[]) =>
  items.reduce<Map<string, number>>((counts, item) => {
    counts.set(String(item), (counts.get(String(item)) ?? 0) + 1)
    return counts
  }, new Map())

const mapToSortedTerms = (counts: Map<string, number>) =>
  [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

export const getCategories = (posts: MdEntry[]) =>
  mapToSortedTerms(countItems(posts.flatMap((post) => post.data.categories ?? [])))

export const getTags = (posts: MdEntry[]) =>
  mapToSortedTerms(countItems(posts.flatMap((post) => getPostTags(post))))

export const getCategoryPath = (category: string) =>
  `/categories/${encodeURIComponent(category)}/`

export const getTagPath = (tag: string) => `/tags/${encodeURIComponent(tag)}/`

export const getPostsByCategory = (posts: MdEntry[], category: string) =>
  sortPosts(posts).filter((post) => post.data.categories?.includes(category))

export const getPostsByTag = (posts: MdEntry[], tag: string) =>
  sortPosts(posts).filter((post) => getPostTags(post).includes(tag))

export const groupPostsByYear = (posts: MdEntry[]) => {
  const groups = new Map<string, MdEntry[]>()
  for (const post of sortPosts(posts)) {
    const year = toDate(post.data.date)?.getFullYear().toString() ?? '未注明日期'
    groups.set(year, [...(groups.get(year) ?? []), post])
  }
  return [...groups.entries()].map(([year, yearPosts]) => ({ year, posts: yearPosts }))
}

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

function getHeroData(settings: Record<string, any> | null) {
  return {
    greeting: settings?.greeting ?? '嗨，我是',
    name: settings?.name ?? '段枫',
    subtitle: settings?.subtitle ?? '又名 DUAN FENG · 爱折腾的创作者',
    bio:
      settings?.bio ??
      '别人叫我「AI 实践者」，我觉得自己只是个爱画画、爱写代码的孩子。把屏幕当画板，把代码当蜡笔，在这里画了 {count} 篇笔记。',
    buttonLabel: settings?.buttonLabel ?? '浏览文章',
  }
}

const defaultSocials = [
  { platform: 'bilibili', href: 'https://space.bilibili.com/46377861', label: 'Bilibili' },
  { platform: 'douyin', href: 'https://www.douyin.com/user/self', label: '抖音' },
  { platform: 'youtube', href: 'https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg', label: 'YouTube' },
  { platform: 'x', href: 'https://x.com/shenfanlaogou', label: 'X' },
  { platform: 'rss', href: '/rss.xml', label: 'RSS 订阅' },
]

const socialIconMap: Record<string, string> = {
  bilibili: 'bilibili',
  douyin: 'douyin',
  youtube: 'youtube',
  x: 'x-platform',
  rss: 'rss',
}

function getSocials(settings: Record<string, any> | null) {
  const items = parseSocials(settings?.socials).map((item) => ({ ...item, label: item.platform }))
  const src = items.length > 0 ? items : defaultSocials
  return src
    .map((item) => ({ ...item, icon: socialIconMap[item.platform] }))
    .filter((item) => item.href && item.icon)
}

function getFooterData(settings: Record<string, any> | null) {
  const iconMap: Record<string, string> = {
    Bilibili: 'bilibili', bilibili: 'bilibili',
    YouTube: 'youtube', youtube: 'youtube',
    RSS: 'rss', rss: 'rss',
    QQ: 'qq', qq: 'qq',
    微信: 'wechat', wechat: 'wechat',
  }
  const footerIconFor = (name: string) => iconMap[name] ?? String(name).toLowerCase()

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

  const channels = parseFooterLines(settings?.footerChannels)
  const groups = parseFooterLines(settings?.footerGroups)
  return {
    subtitle: settings?.footerSubtitle ?? 'AI · Code · Web',
    channels:
      channels.length > 0
        ? channels
        : [
            { name: 'Bilibili', icon: 'bilibili', href: 'https://space.bilibili.com/46377861' },
            { name: 'YouTube', icon: 'youtube', href: 'https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg' },
            { name: 'RSS', icon: 'rss', href: '/rss.xml' },
          ],
    groups:
      groups.length > 0
        ? groups
        : [
            { name: 'QQ 交流群', icon: 'qq', href: '' },
            { name: '微信交流群', icon: 'wechat', href: '' },
          ],
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
// 图标渲染（复刻 Icon.astro：线性图标 + 品牌实心图标）
// ---------------------------------------------------------------------------

const icons: Record<string, string> = {
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  cloud: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .3-6.98 5 5 0 0 0-9.65-1.35A3.75 3.75 0 0 0 7 18Z"/>',
  'cloud-drizzle': '<path d="M8 12.5a4 4 0 0 1 .2-7.97 5 5 0 0 1 9.5 1.3 3.5 3.5 0 0 1 .3 6.67"/><path d="M8 17v1.5M8 20.5V21M12 18v1.5M12 21.5V22M16 17v1.5M16 20.5V21"/>',
  'cloud-rain': '<path d="M8 12.5a4 4 0 0 1 .2-7.97 5 5 0 0 1 9.5 1.3 3.5 3.5 0 0 1 .3 6.67"/><path d="M8 16v4M12 17v4M16 16v4"/>',
  'cloud-snow': '<path d="M8 12.5a4 4 0 0 1 .2-7.97 5 5 0 0 1 9.5 1.3 3.5 3.5 0 0 1 .3 6.67"/><path d="M8 17h.01M8 20.5h.01M12 18.5h.01M12 22h.01M16 17h.01M16 20.5h.01"/>',
  'cloud-lightning': '<path d="M8 12.5a4 4 0 0 1 .2-7.97 5 5 0 0 1 9.5 1.3 3.5 3.5 0 0 1 .3 6.67"/><path d="M12 15.5l-2 3.5h3l-2 3.5"/>',
  wind: '<path d="M3 8h10a2.5 2.5 0 1 0-2.45-3M3 16h14a2.5 2.5 0 1 1-2.45 3M3 12h7"/>',
  fog: '<path d="M4 9h16M4 13h11M9 17h11M4 17h2"/>',
  smile: '<circle cx="12" cy="12" r="9.5"/><path d="M8.4 14.2a4 4 0 0 0 7.2 0"/><path d="M9 9.6h.01M15 9.6h.01"/>',
  meh: '<circle cx="12" cy="12" r="9.5"/><path d="M8.5 15h7"/><path d="M9 9.6h.01M15 9.6h.01"/>',
  frown: '<circle cx="12" cy="12" r="9.5"/><path d="M8.4 15.6a4 4 0 0 1 7.2 0"/><path d="M9 9.6h.01M15 9.6h.01"/>',
  tired: '<circle cx="12" cy="12" r="9.5"/><path d="M7.8 9.6h2.6M13.6 9.6h2.6"/><path d="M9.5 15.4h5"/>',
  heart: '<path d="M12 20.3 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z"/>',
  idea: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6.2 6.2 0 0 0-3.8 11.1c.6.5 1 1.2 1.05 2h5.5c.05-.8.45-1.5 1.05-2A6.2 6.2 0 0 0 12 3Z"/>',
}

const brandIcons: Record<string, string> = {
  bilibili:
    '<path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/>',
  douyin:
    '<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
  youtube:
    '<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>',
  'x-platform':
    '<path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/>',
  rss: '<path d="M19.199 24C19.199 13.467 10.533 4.8 0 4.8V0c13.165 0 24 10.835 24 24h-4.801zM3.291 17.415c1.814 0 3.293 1.479 3.293 3.295 0 1.813-1.485 3.29-3.301 3.29C1.47 24 0 22.526 0 20.71s1.475-3.294 3.291-3.295zM15.909 24h-4.665c0-6.169-5.075-11.245-11.244-11.245V8.09c8.727 0 15.909 7.184 15.909 15.91z"/>',
  qq: '<path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/>',
  wechat: '<path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>',
}

function iconSvg(name: string, size = 20, className?: string, strokeWidth = 1.75): string {
  const isBrand = name in brandIcons
  const path = isBrand ? brandIcons[name] : (icons[name] ?? '')
  const renderSize = isBrand ? Math.round(size * 0.75) : size
  const brandAdjust: Record<string, { scale?: number; dx?: number; dy?: number }> = {
    'x-platform': { scale: 0.86 },
    rss: { scale: 0.82, dx: 1.3, dy: -1.3 },
  }
  const adj = isBrand ? brandAdjust[name] : undefined
  const brandTransform = adj
    ? `translate(${adj.dx ?? 0} ${adj.dy ?? 0}) translate(12 12) scale(${adj.scale ?? 1}) translate(-12 -12)`
    : undefined
  const cls = className ? ` class="${escapeAttr(className)}"` : ''
  if (isBrand) {
    const g = brandTransform ? `<g transform="${escapeAttr(brandTransform)}">` : '<g>'
    return `<svg${cls} width="${renderSize}" height="${renderSize}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${g}${path}</g></svg>`
  }
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

// ---------------------------------------------------------------------------
// Markdown 渲染（与 Astro 构建管线一致：插件顺序 + shiki github-dark 高亮）
// ---------------------------------------------------------------------------

const SHIKI_LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'html', 'css', 'scss', 'json',
  'bash', 'sh', 'shell', 'python', 'sql', 'markdown', 'yaml', 'xml', 'diff',
  'go', 'rust', 'java', 'c', 'cpp', 'dockerfile', 'makefile', 'graphql', 'plaintext',
]

let highlighterPromise: Promise<ReturnType<typeof createHighlighter>> | null = null

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

/** 渲染 markdown 为 HTML，返回正文与标题列表（用于目录） */
export async function renderMarkdown(md: string): Promise<{ html: string; headings: Heading[] }> {
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
    .use(rehypeImgAttrs)
    .use(() => collectHeadings)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md)

  const html = await highlightCodeBlocks(String(file))
  return { html, headings }
}

// ---------------------------------------------------------------------------
// 区块渲染（与各 .astro 模板结构一一对应）
// ---------------------------------------------------------------------------

/** PostSummary.astro */
export function renderPostSummary(
  post: MdEntry,
  opts: { hideYear?: boolean; compact?: boolean } = {},
): string {
  const { hideYear = false, compact = false } = opts
  const date = toDate(post.data.date)
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthDay = date ? `${pad(date.getMonth() + 1)}·${pad(date.getDate())}` : ''
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
            !hideYear ? `<span class="post-row__yy">${date.getFullYear()}</span>` : ''
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

/** 首页 Hero 卡片（index.astro hero__card） */
export function renderHeroCard(
  hero: { greeting: string; name: string; subtitle: string; bio: string; buttonLabel: string },
  socials: Array<{ href: string; icon: string; label: string }>,
): string {
  const socialHtml = socials
    .map(
      (item) =>
        `<a class="icon-button" href="${escapeAttr(item.href)}" ${
          item.href.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''
        } aria-label="${escapeAttr(item.label)}">${iconSvg(item.icon)}</a>`,
    )
    .join('')

  return `<div class="hero__card">
  <span class="hero__arrow" aria-hidden="true"></span>
  <span class="hero__sticker hero__sticker--1" aria-hidden="true"></span>
  <span class="hero__sticker hero__sticker--2" aria-hidden="true"></span>
  <h1 class="hero__title">${escapeHtml(hero.greeting)}<span class="hero__name">${escapeHtml(hero.name)}</span>！</h1>
  <p class="hero__subtitle">${escapeHtml(hero.subtitle)}</p>
  <p class="hero__bio">${escapeHtml(hero.bio)}</p>
  <div class="hero__actions">
    <a class="hero__tag" href="/archive/">${escapeHtml(hero.buttonLabel)}${iconSvg('arrow-right', 16)}</a>
    <span class="hero__social" aria-label="社交链接">${socialHtml}</span>
  </div>
</div>`
}

/** 首页精选（index.astro hero__picks） */
export function renderHeroPicks(picks: MdEntry[]): string {
  if (picks.length === 0) return ''
  const first = picks[0]
  const cover = getPostCover(first)
  const category = getPostCategory(first)
  const date = toDate(first.data.date)
  const thumb = cover
    ? `<span class="pick-hero__thumb"><img src="${escapeAttr(cover)}" alt="" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" /></span>`
    : `<span class="pick-hero__thumb pick__thumb--fallback" style="--h:${coverHue(String(first.data.title))}"></span>`

  const side = picks.slice(1, 5).map((post) => {
    const c = getPostCover(post)
    const d = toDate(post.data.date)
    const t = c
      ? `<span class="pick-side__thumb"><img src="${escapeAttr(c)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
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

  return `<aside class="hero__picks" aria-label="精选文章">
  <p class="hero__picks-label">精选</p>
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
  </div>
</aside>`
}

/** 导航链接（Nav.astro 中 .site-nav__tags 的动态链接部分） */
export function renderNavLinks(
  navItems: Array<{ href: string; label: string }>,
  pathname: string,
): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  const isCurrent = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href)

  return navItems
    .map(
      (item) =>
        `<a href="${escapeAttr(item.href)}" class="site-nav__tag${isCurrent(item.href) ? ' is-current' : ''}" data-nav-route>${escapeHtml(item.label)}</a>`,
    )
    .join('')
}

/** 页脚主体（Footer.astro .site-footer__inner） */
export function renderFooterInner(
  footer: { subtitle: string; channels: Array<{ name: string; icon: string; href: string }>; groups: Array<{ name: string; icon: string; href: string }> },
  author: string,
): string {
  const link = (item: { name: string; icon: string; href: string }, plain = false) =>
    plain
      ? `<span class="site-footer__item">${iconSvg(item.icon, 15)}${escapeHtml(item.name)}</span>`
      : `<a href="${escapeAttr(item.href)}" ${item.href.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${iconSvg(item.icon, 15)}${escapeHtml(item.name)}</a>`

  const channelsHtml = footer.channels.map((c) => link(c)).join('')
  const groupsHtml = footer.groups.map((g) => (g.href ? link(g) : link(g, true))).join('')

  return `<div class="site-footer__inner">
  <div class="site-footer__id">
    <img src="/avatars/avatar.png" alt="${escapeAttr(author)}" class="site-footer__avatar" width="40" height="40" />
    <div class="site-footer__id-text">
      <strong>${escapeHtml(author)}</strong>
      <span>${escapeHtml(footer.subtitle)}</span>
    </div>
  </div>
  <nav class="site-footer__links" aria-label="页脚链接">
    ${channelsHtml}
    <span class="site-footer__sep" aria-hidden="true"></span>
    ${groupsHtml}
  </nav>
</div>`
}

/** 页脚底栏（Footer.astro .site-footer__bar） */
export function renderFooterBar(author: string, year: number): string {
  return `<div class="site-footer__bar">
  <span>© ${year} ${escapeHtml(author)}</span>
  <span aria-hidden="true">·</span>
  <a href="${escapeAttr(site.url)}">${escapeHtml(site.url.replace('https://', ''))}</a>
  <span aria-hidden="true">·</span>
  <span>由 <a href="https://astro.build" target="_blank" rel="noopener noreferrer">Astro</a> 构建</span>
</div>`
}

/** 文章详情头部（posts/[slug].astro article__header） */
export function renderArticleHeader(
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
      ? `<img class="article__cover" src="${escapeAttr(cover)}" alt="" loading="eager" fetchpriority="high" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/covers/default-cover.svg'" />`
      : ''

  const meta = [
    category ? `<span>${escapeHtml(category)}</span>` : '',
    date ? `<time datetime="${date.toISOString()}">${formatDate(date)}</time>` : '',
    updated ? `<span>更新于 ${formatDate(updated)}</span>` : '',
    `<span>${readingMinutes} 分钟阅读</span>`,
  ].join('')

  const tagHtml =
    tags.length > 0
      ? `<div class="tag-list" aria-label="标签">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
      : ''

  return `<header class="article__header">
  <div class="post-meta">${meta}</div>
  <h1>${escapeHtml(post.data.title)}</h1>
  <p>${escapeHtml(description)}</p>
  ${tagHtml}
  ${coverHtml}
</header>`
}

/** 文章正文（.post-content，markdown 渲染） */
export async function renderArticleContent(post: MdEntry): Promise<string> {
  const { html } = await renderMarkdown(post.body)
  return `<div class="post-content">${html}</div>`
}

/** 文章侧栏目录（posts/[slug].astro article__aside） */
export function renderTocSidebar(tocGroups: Array<{ slug: string; text: string; children: Array<{ slug: string; text: string }> }>): string {
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
  return `<aside class="article__aside">
  <nav class="toc" aria-labelledby="toc-heading">
    <h2 id="toc-heading">目录</h2>
    <ol>${items}</ol>
  </nav>
</aside>`
}

/** 文章页脚（相邻文章 + 相关文章） */
export function renderArticleFooter(
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

  return `<footer class="article__footer">
  ${navHtml}
  ${relatedHtml}
</footer>`
}

/** 归档页头部（含文章数） */
export function renderArchiveHeader(count: number): string {
  return `<header class="page-header">
  <p class="eyebrow">Archive</p>
  <h1>文章归档</h1>
  <p>目前收录 ${count} 篇文章，可以按时间、分类或标签浏览。</p>
</header>`
}

/** 归档页分类/标签索引面板 */
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

  return `<section class="archive-summary" aria-label="内容索引">
  <div class="taxonomy-panel">
    <h2>${iconSvg('layers', 16)}分类</h2>
    <div class="term-list">${catHtml}</div>
  </div>
  <div class="taxonomy-panel">
    <h2>${iconSvg('hash', 16)}标签</h2>
    <div class="term-list">${tagHtml}</div>
    ${restHtml}
  </div>
</section>`
}

/** 归档页按年份分组列表 */
export function renderArchiveYears(years: Array<{ year: string; posts: MdEntry[] }>): string {
  return years
    .map(
      (group) => `<section class="archive-year">
  <header class="archive-year__head">
    <h2 class="archive-year__num">${escapeHtml(group.year)}</h2>
    <span class="archive-year__count">${group.posts.length} 篇</span>
  </header>
  <div class="post-list">
    ${group.posts.map((p) => renderPostSummary(p, { hideYear: true, compact: true })).join('')}
  </div>
</section>`,
    )
    .join('')
}

/** 分类/标签切换器（categories/[category].astro term-switcher） */
export function renderTermSwitcher(
  terms: Array<{ name: string; count: number }>,
  current: string,
  kind: 'categories' | 'tags',
): string {
  const pathFor = kind === 'categories' ? getCategoryPath : getTagPath
  return `<nav class="term-switcher" aria-label="全部${kind === 'categories' ? '分类' : '标签'}">
  ${terms
    .map(
      (item) =>
        `<a href="${escapeAttr(pathFor(item.name))}" class="${item.name === current ? 'is-current' : ''}"><span>${escapeHtml(item.name)}</span><small>${item.count}</small></a>`,
    )
    .join('')}
</nav>`
}

/** 文章列表（通用：分类/标签页 post-list） */
export function renderPostList(posts: MdEntry[], compact = false): string {
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
async function renderNote(note: MdEntry, anchor?: string): Promise<string> {
  const date = toDate(note.data.date)
  const { html } = await renderMarkdown(note.body)
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

/** 随笔页完整 feed（含年份分组与时间索引） */
export async function renderNotesFeed(notes: MdEntry[]): Promise<{
  feed: string
  aside: string
}> {
  const sorted = [...notes].sort(
    (a, b) => (toDate(b.data.date)?.getTime() ?? 0) - (toDate(a.data.date)?.getTime() ?? 0),
  )

  const byYear: { year: string; notes: MdEntry[] }[] = []
  for (const note of sorted) {
    const year = String(toDate(note.data.date)?.getFullYear() ?? '')
    const group = byYear.find((g) => g.year === year)
    if (group) group.notes.push(note)
    else byYear.push({ year, notes: [note] })
  }

  const monthAnchor = new Map<string, string>()
  const seenMonth = new Set<string>()
  for (const note of sorted) {
    const d = toDate(note.data.date)
    if (!d) continue
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    if (!seenMonth.has(key)) {
      seenMonth.add(key)
      monthAnchor.set(note.id, `t-${key}`)
    }
  }

  const timeIndex = byYear.map((group) => ({
    year: group.year,
    months: group.notes
      .filter((n) => monthAnchor.has(n.id))
      .map((n) => ({
        label: `${toDate(n.data.date)!.getMonth() + 1}月`,
        anchor: monthAnchor.get(n.id)!,
      })),
  }))

  const feedParts: string[] = []
  for (const group of byYear) {
    const items: string[] = []
    for (const note of group.notes) {
      items.push(await renderNote(note, monthAnchor.get(note.id)))
    }
    feedParts.push(
      `<section class="notes-year" id="y-${group.year}"><h2 class="notes-year__label"><span>${group.year}</span></h2>${items.join('')}</section>`,
    )
  }

  const aside =
    byYear.length > 1
      ? `<aside class="notes-aside">
  <nav class="toc" aria-labelledby="notes-time-heading">
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
  </nav>
</aside>`
      : ''

  return { feed: `<div class="notes-feed">${feedParts.join('')}</div>`, aside }
}

// ---------------------------------------------------------------------------
// 各页面 blocks 组装
// ---------------------------------------------------------------------------

interface SyncData {
  posts: MdEntry[]
  notes: MdEntry[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string }>
  version: string
}

/** 首页 */
async function homeBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const { posts, settings } = ctx
  const sorted = sortPosts(posts)
  const featured = sorted.filter((p) => Number(p.data.sticky ?? 0) > 0)
  const latest = sortPostsByDate(sorted).slice(0, 8)
  const heroPicks = [
    ...featured,
    ...latest.filter((p) => !featured.some((f) => f.id === p.id)),
  ].slice(0, 5)

  const hero = getHeroData(settings)
  const heroBio = hero.bio.replace('{count}', String(posts.length))
  const socials = getSocials(settings)
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/'),
    footerInner: renderFooterInner(getFooterData(settings), settings?.siteAuthor ?? site.author),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, new Date().getFullYear()),
    heroCard: renderHeroCard({ ...hero, bio: heroBio }, socials),
    heroPicks: renderHeroPicks(heroPicks),
    latestPosts: latest.map((p) => renderPostSummary(p)).join(''),
    heroCount: `全部 ${posts.length} 篇`,
  }
}

/** 文章详情页 */
async function postBlocks(ctx: SyncData, pathname: string): Promise<Record<string, string | null>> {
  const slug = decodeURIComponent(pathname.split('/')[2] ?? '')
  const posts = sortPosts(ctx.posts)
  const post = posts.find((p) => p.id === slug)
  if (!post) return { postContent: null }

  const { html, headings } = await renderMarkdown(post.body)
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
    footerInner: renderFooterInner(getFooterData(settings), settings?.siteAuthor ?? site.author),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, new Date().getFullYear()),
    pageTitle: `${escapeHtml(post.data.title)} - ${siteName}`,
    articleHeader: renderArticleHeader(post, { hasToc }),
    postContent: `<div class="post-content">${html}</div>`,
    tocSidebar: hasToc ? renderTocSidebar(tocGroups) : '',
    articleFooter: renderArticleFooter(newer, older, related),
  }
}

/** 归档页 */
async function archiveBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const years = groupPostsByYear(posts)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/archive/'),
    footerInner: renderFooterInner(getFooterData(settings), settings?.siteAuthor ?? site.author),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, new Date().getFullYear()),
    archiveHeader: renderArchiveHeader(posts.length),
    archiveSummary: renderArchiveSummary(getCategories(posts), getTags(posts)),
    archiveYears: renderArchiveYears(years),
  }
}

/** 随笔页 */
async function notesBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const { feed, aside } = await renderNotesFeed(ctx.notes)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/notes/'),
    footerInner: renderFooterInner(getFooterData(settings), settings?.siteAuthor ?? site.author),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, new Date().getFullYear()),
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
    footerInner: renderFooterInner(getFooterData(settings), settings?.siteAuthor ?? site.author),
    footerBar: renderFooterBar(settings?.siteAuthor ?? site.author, new Date().getFullYear()),
    termSwitcher: renderTermSwitcher(terms, term, kind),
    termPostList: renderPostList(posts, true),
    termCount:
      kind === 'categories'
        ? `这个分类下共有 ${posts.length} 篇文章。`
        : `这个标签下共有 ${posts.length} 篇文章。`,
  }
}

/**
 * 根据页面路径组装动态区块（/api/blog-sync 的主入口）。
 * pathname 形如 '/posts/xxx'、'/archive'、'/notes'、'/categories/xxx'、'/tags/xxx'。
 */
export async function renderBlocksForPathname(pathname: string): Promise<{
  version: string
  title: string | null
  blocks: Record<string, string | null>
}> {
  const [posts, notes, settings, nav, version] = await Promise.all([
    fetchPosts(),
    fetchNotes(),
    getSiteSettingsData(),
    getNavData(),
    getDataVersion(),
  ])
  const ctx: SyncData = { posts, notes, settings, nav, version }
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  const siteName = settings?.siteName ?? site.name

  if (path === '/') {
    const blocks = await homeBlocks(ctx)
    return { version, title: siteName, blocks }
  }
  if (path.startsWith('/posts/')) {
    const blocks = await postBlocks(ctx, path)
    return { version, title: (blocks.pageTitle as string) ?? siteName, blocks }
  }
  if (path === '/notes/') {
    return { version, title: `随笔 - ${siteName}`, blocks: await notesBlocks(ctx) }
  }
  if (path === '/archive/') {
    return { version, title: `归档 - ${siteName}`, blocks: await archiveBlocks(ctx) }
  }
  if (path.startsWith('/categories/')) {
    const blocks = await termBlocks(ctx, path, 'categories')
    return { version, title: `分类 - ${siteName}`, blocks }
  }
  if (path.startsWith('/tags/')) {
    const blocks = await termBlocks(ctx, path, 'tags')
    return { version, title: `标签 - ${siteName}`, blocks }
  }
  return { version, title: siteName, blocks: {} }
}
