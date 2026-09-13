/**
 * 博客前台数据同步 —— 数据层
 *
 * 功能：
 * 1. 通过 Payload 本地 API（getPayload）直接查询数据库，不走 HTTP，避免端口/域名依赖
 * 2. 将 Payload 数据转换为与前台一致的 MdEntry 结构（id + data + body）
 * 3. 提供数据版本号（posts/notes/projects/site-settings/navigation 的最大 updatedAt），
 *    供前台客户端轮询/SSE 检测「后台数据变化 → 自动同步」
 *
 * 性能：版本号直接从一次全量查询的结果里计算（取各文档 updatedAt 的最大值），
 * 不再为版本号单独再查一遍库；全量数据本身被 sync-cache 快照缓存，无变化时零查库。
 */
import { getPayload } from 'payload'
import config from '@payload-config'
import { getSnapshot, setSnapshot, type SyncSnapshot } from './sync-cache'

// getPayload 实例进程内缓存（避免每次请求重建数据库连接）
type PayloadDb = Awaited<ReturnType<typeof getPayload>>
let dbPromise: Promise<PayloadDb> | null = null

function getDb(): Promise<PayloadDb> {
  if (!dbPromise) {
    dbPromise = getPayload({ config }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

/** 与前台 content schema 兼容的 markdown 条目；updatedAt 用于计算版本号 */
export interface MdEntry {
  id: string
  data: Record<string, any>
  body: string
  updatedAt?: string
}

/** 项目条目（关于页项目区，来自 projects 集合） */
export interface ProjectEntry {
  id: string
  group: string
  groupDescription?: string
  title: string
  owner?: string
  description?: string
  icon: string
  href?: string
  articleHref?: string
  stars: number
  tags?: string[]
  sortOrder: number
  updatedAt?: string
}

/** 把浅关系字段（分类/标签）归一为名称字符串列表 */
function namesOf(refs?: Array<{ name: string } | number>): string[] | undefined {
  if (!refs?.length) return undefined
  return refs.map((r) => (typeof r === 'object' ? String(r.name) : String(r)))
}

/** 把「每行一个」的文本拆为数组（keywords/ai/tags 字段） */
function linesOf(text?: string | null): string[] | undefined {
  if (!text) return undefined
  const list = String(text).split('\n').map((s) => s.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

/** 拉取全部已发布文章，按 slug 作为 id（与前台路径一致） */
export async function fetchPosts(): Promise<MdEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({
    collection: 'posts',
    depth: 1,
    limit: 0,
    sort: '-sticky,-createdAt',
  })

  return docs
    .filter((doc: any) => doc.status === 'published')
    .map((doc: any) => ({
      id: doc.slug,
      data: {
        title: doc.title,
        description: doc.description ?? undefined,
        date: String(doc.createdAt),
        cover: doc.cover ?? undefined,
        categories: namesOf(doc.categories),
        tags: namesOf(doc.tags),
        keywords: linesOf(doc.keywords),
        ai: linesOf(doc.ai),
        sticky: doc.sticky ?? undefined,
      },
      body: doc.content ?? '',
      updatedAt: doc.updatedAt,
    }))
}

/** 拉取全部已发布随笔（以本地时区日期作为 id，与前台一致） */
export async function fetchNotes(): Promise<MdEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({ collection: 'notes', depth: 1, limit: 0, sort: 'date' })

  return docs
    .filter((doc: any) => doc.status === 'published')
    .map((doc: any) => {
      const d = new Date(doc.date)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return {
        id: `${d.getFullYear()}-${mm}-${dd}`,
        data: {
          date: doc.date,
          title: doc.title ?? undefined,
          mood: doc.mood ?? undefined,
          tags: namesOf(doc.tags),
        },
        body: doc.content ?? '',
        updatedAt: doc.updatedAt,
      }
    })
}

/** 拉取全部已发布项目（关于页项目区，按 sortOrder 升序） */
export async function fetchProjects(): Promise<ProjectEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({
    collection: 'projects',
    limit: 0,
    sort: 'sortOrder',
  })

  return docs
    .filter((doc: any) => doc.status === 'published')
    .map((doc: any) => ({
      id: String(doc.id),
      group: doc.group,
      groupDescription: doc.groupDescription ?? undefined,
      title: doc.title,
      owner: doc.owner ?? undefined,
      description: doc.description ?? undefined,
      icon: doc.icon ?? 'github',
      href: doc.href ?? undefined,
      articleHref: doc.articleHref ?? undefined,
      stars: Number(doc.stars ?? 0),
      tags: linesOf(doc.tags),
      sortOrder: Number(doc.sortOrder ?? 0),
      updatedAt: doc.updatedAt,
    }))
}

/** 站点设置（SiteSettings Global 单例，扁平字段）；不可用时返回 null */
export async function getSiteSettingsData(): Promise<Record<string, any> | null> {
  try {
    const payload = await getDb()
    const global = await payload.findGlobal({ slug: 'site-settings' })
    return (global ?? null) as Record<string, any> | null
  } catch {
    return null
  }
}

/** 把后台「每行一条 「文字 链接」」的导航文本解析为结构化数组 */
function parseNavLines(text?: string | null): Array<{ href: string; label: string }> {
  if (!text) return []
  const out: Array<{ href: string; label: string }> = []
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 用最后一个空格切分：文字可含空格，链接为 URL 通常不含空格
    const sp = trimmed.lastIndexOf(' ')
    if (sp === -1) continue
    const label = trimmed.slice(0, sp).trim()
    const href = trimmed.slice(sp + 1).trim()
    if (label && href) out.push({ href, label })
  }
  return out
}

/** 导航全局原始数据（保留 updatedAt 供版本号计算）；后台不可用时返回 null */
export async function getNavGlobal(): Promise<{ navItems?: string | null; updatedAt?: string } | null> {
  try {
    const payload = await getDb()
    const global = await payload.findGlobal({ slug: 'navigation' })
    return (global ?? null) as { navItems?: string | null; updatedAt?: string } | null
  } catch {
    return null
  }
}

const DEFAULT_NAV = [
  { href: '/', label: '首页' },
  { href: '/notes/', label: '随笔' },
  { href: '/archive/', label: '归档' },
  { href: '/about/', label: '关于' },
]

/** 导航项（Navigation Global 单例）；后台不可用或为空时回退默认四项 */
export async function getNavData(): Promise<Array<{ href: string; label: string }>> {
  const global = await getNavGlobal()
  const items = parseNavLines(global?.navItems)
  return items.length > 0 ? items.filter((item) => item.href && item.label) : DEFAULT_NAV
}

export interface FetchAllResult {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string }>
  navUpdatedAt?: string
}

/** 一次性并行拉取全部前台所需数据（5 次查询，覆盖文章/随笔/项目/站点设置/导航） */
export async function fetchAllData(): Promise<FetchAllResult> {
  const [posts, notes, projects, settings, navGlobal] = await Promise.all([
    fetchPosts(),
    fetchNotes(),
    fetchProjects(),
    getSiteSettingsData(),
    getNavGlobal(),
  ])
  const items = parseNavLines(navGlobal?.navItems)
  const nav = items.length > 0 ? items.filter((item) => item.href && item.label) : DEFAULT_NAV
  return { posts, notes, projects, settings, nav, navUpdatedAt: navGlobal?.updatedAt }
}

/** 从已查数据计算版本号：各文档/全局 updatedAt 的最大值（毫秒时间戳） */
export function computeVersion(data: FetchAllResult): string {
  const stamps: number[] = []
  for (const p of data.posts) if (p.updatedAt) stamps.push(new Date(p.updatedAt).getTime())
  for (const n of data.notes) if (n.updatedAt) stamps.push(new Date(n.updatedAt).getTime())
  for (const pr of data.projects) if (pr.updatedAt) stamps.push(new Date(pr.updatedAt).getTime())
  if (data.settings?.updatedAt) stamps.push(new Date(data.settings.updatedAt).getTime())
  if (data.navUpdatedAt) stamps.push(new Date(data.navUpdatedAt).getTime())
  return String(stamps.length ? Math.max(...stamps) : Date.now())
}

/**
 * 取同步数据快照：命中缓存直接返回（零查库），否则全量拉取并缓存。
 * afterChange 钩子会清除快照，使下一次调用重新查库拿到最新数据。
 */
export async function getSyncData(): Promise<SyncSnapshot> {
  const cached = getSnapshot()
  if (cached) return cached

  const data = await fetchAllData()
  const version = computeVersion(data)
  const snapshot: SyncSnapshot = {
    posts: data.posts,
    notes: data.notes,
    projects: data.projects,
    settings: data.settings,
    nav: data.nav,
    navUpdatedAt: data.navUpdatedAt,
    version,
    ts: Date.now(),
  }
  setSnapshot(snapshot)
  return snapshot
}
