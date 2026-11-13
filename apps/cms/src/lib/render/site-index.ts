/**
 * 站内搜索索引（/site-index.json）
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry, ProjectEntry } from '../blog-sync'
import {
  formatDate,
  sortPosts,
  getPostExcerpt,
  getPostCategory,
  getPostTags,
  getCategories,
  getTags,
  getCategoryPath,
  getTagPath,
} from 'cloud-blog/shared/post-utils'
import { groupProjects, projectGroupDomId } from './blocks-about'
import { noteMonthAnchorIds } from './blocks-notes'
import { site } from './config'
import { getPostPath } from './util'

export interface SiteIndexEntry {
  kind: 'page' | 'post' | 'note' | 'project' | 'category' | 'tag'
  title: string
  subtitle: string
  meta: string
  url: string
  tags: string[]
  text: string
}

/** 拼小写匹配域：空值直接丢掉，避免多余空格把词切碎（与前台 site-index.ts 同一份规则） */

export function matchField(...parts: Array<string | string[] | undefined | null>): string {
  return parts
    .flat()
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase()
}

export const stripMarkdown = (value: string) =>
  value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-+]\s+/, '')
    .trim()

/** 随笔大多没有标题，拿正文首行当摘要（与前台同规则） */

export function noteFirstLine(body: string): string {
  for (const line of body.split('\n')) {
    const text = stripMarkdown(line)
    if (text) return text.length > 46 ? `${text.slice(0, 46)}…` : text
  }
  return ''
}

/** 导航之外的常驻页面（与前台 site-index.ts 的 EXTRA_PAGES 一致） */

export const EXTRA_INDEX_PAGES: Array<{ href: string; label: string; keywords: string }> = [
  { href: '/stats', label: '统计', keywords: '数据 statistics 归档 标签墙' },
  { href: '/tags', label: '标签墙', keywords: '标签 tags 分类 cloud 拾取' },
  { href: '/privacy', label: '隐私政策', keywords: '隐私 privacy 政策 条款 数据 个人信息 合规' },
]

export function buildSiteIndex(ctx: {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  nav: Array<{ href: string; label: string; external?: boolean }>
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
      text: matchField(post.data.title, excerpt, getPostCategory(post), getPostTags(post), post.data.keywords),
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
      url: anchor ? `/notes#${anchor}` : '/notes',
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
    url: project.articleHref ?? `/about#${groupIds.get(project.group)}`,
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

/**
 * 根据页面路径组装动态区块（/api/blog-sync 的主入口）。
 * pathname 形如 '/'、'/posts/xxx'、'/archive'、'/notes'、'/about'、'/categories/xxx'、'/tags/xxx'。
 *
 * 性能：先取 sync-cache 的数据快照（命中则零查库）；若该 pathname 的区块缓存版本号
 * 与当前一致，直接返回缓存（零渲染）。否则渲染一次并写回区块缓存。afterChange 钩子
 * 会清除缓存，使下一次请求重新渲染最新数据。
 */
