/**
 * 博客前台数据同步 —— 数据层
 *
 * 功能：
 * 1. 通过 Payload 本地 API（getPayload）直接查询数据库，不走 HTTP，避免端口/域名依赖
 * 2. 将 Payload 数据转换为与前台一致的 MdEntry 结构（id + data + body）
 * 3. 提供数据版本号（posts/notes/site-settings/navigation 的最大 updatedAt），
 *    供前台客户端轮询检测「后台数据变化 → 自动同步」
 */
import { getPayload } from 'payload'
import config from '@payload-config'

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

/** 与前台 content schema 兼容的 markdown 条目 */
export interface MdEntry {
  id: string
  data: Record<string, any>
  body: string
}

/** 把浅关系字段（分类/标签）归一为名称字符串列表 */
function namesOf(refs?: Array<{ name: string } | number>): string[] | undefined {
  if (!refs?.length) return undefined
  return refs.map((r) => (typeof r === 'object' ? String(r.name) : String(r)))
}

/** 把「每行一个」的文本拆为数组（keywords/ai 字段） */
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
      }
    })
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

/** 导航项（Navigation Global 单例）；后台不可用时回退默认四项 */
export async function getNavData(): Promise<Array<{ href: string; label: string }>> {
  try {
    const payload = await getDb()
    const global = await payload.findGlobal({ slug: 'navigation' })
    const items = parseNavLines((global as any)?.navItems)
    return items.length > 0
      ? items.filter((item) => item.href && item.label)
      : [
          { href: '/', label: '首页' },
          { href: '/notes/', label: '随笔' },
          { href: '/archive/', label: '归档' },
          { href: '/about/', label: '关于' },
        ]
  } catch {
    return [
      { href: '/', label: '首页' },
      { href: '/notes/', label: '随笔' },
      { href: '/archive/', label: '归档' },
      { href: '/about/', label: '关于' },
    ]
  }
}

/**
 * 数据版本号：posts / notes / site-settings / navigation 的最大 updatedAt（毫秒时间戳）。
 * 任意数据被修改后版本号必然变化，前台据此触发自动同步。
 */
export async function getDataVersion(): Promise<string> {
  const payload = await getDb()
  const stamps: number[] = []

  for (const collection of ['posts', 'notes'] as const) {
    try {
      const { docs } = await (payload as any).find({
        collection,
        limit: 0,
        fields: ['updatedAt'],
      })
      for (const doc of docs) stamps.push(new Date((doc as any).updatedAt).getTime())
    } catch {
      // 集合查询失败时跳过（不影响版本检测）
    }
  }

  for (const slug of ['site-settings', 'navigation'] as const) {
    try {
      const global = await (payload as any).findGlobal({ slug })
      stamps.push(new Date((global as any).updatedAt).getTime())
    } catch {
      // 忽略
    }
  }

  return String(stamps.length ? Math.max(...stamps) : Date.now())
}
