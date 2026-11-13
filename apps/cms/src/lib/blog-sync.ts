/**
 * 博客前台数据同步 —— 数据层
 *
 * 功能：
 * 1. 通过 Payload 本地 API（getPayload）直接查询数据库，不走 HTTP，避免端口/域名依赖
 * 2. 将 Payload 数据转换为与前台一致的 MdEntry 结构（id + data + body）
 * 3. 提供数据版本号（posts/notes/projects/site-settings/navigation 的最大 updatedAt），
 *    供前台客户端轮询/SSE 检测「后台数据变化 → 自动同步」
 *
 * 性能：版本号不再走全量查询 —— /api/blog-sync?digest=1 / ?version=1 探测路径调用
 * getSyncProbe()，只用「count + 单行 max updatedAt」的精简查询（status 过滤在 DB 层），
 * 结果带独立 TTL 缓存；全量数据本身被 sync-cache 快照缓存，无变化时零查库。
 */
import { getPayload } from 'payload'
import config from '@payload-config'
import { DEFAULT_PROJECT_ICON, sanitizeTerm } from 'cloud-blog/shared/post-utils'
import { normalizeSiteHref } from 'cloud-blog/shared/free-text-lines'
import { isExternalHref } from 'cloud-blog/shared/site-pages'
import {
  getSnapshot,
  setSnapshot,
  getProbe,
  setProbe,
  getMutationSeq,
  type SyncSnapshot,
  type SyncProbe,
} from './sync-cache'

// getPayload 实例进程内缓存（避免每次请求重建数据库连接）
export type PayloadDb = Awaited<ReturnType<typeof getPayload>>
let dbPromise: Promise<PayloadDb> | null = null

/** 进程内单例的 Payload 实例；各 API 路由共用，避免各自 getPayload 反复初始化 */
export function getDb(): Promise<PayloadDb> {
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

/**
 * 友链条目（/friends 页，来自 friends 集合）
 *
 * 只带前台展示需要的字段：email / message / submitIp 属于运营信息，
 * 一律不进同步快照 —— 快照会被匿名接口 /api/blog-sync 整体序列化下发。
 */
export interface FriendEntry {
  id: string
  name: string
  url: string
  description?: string
  avatar?: string
  group: string
  groupDescription?: string
  note?: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

/** 把浅关系字段（分类/标签）归一为名称字符串列表。
 * 数字 id（未展开的关联，status 非 published 时被 Payload 回退为裸数字）
 * 整条丢弃，避免渲染出 "123" 假标签 —— 与前台 payload-api.namesOf 同口径 */
function namesOf(
  refs?: Array<{ name: string } | number> | { name?: string } | number | null | undefined,
): string[] | undefined {
  if (!refs) return undefined
  const arr = Array.isArray(refs) ? refs : [refs]
  if (arr.length === 0) return undefined
  const names = arr
    .filter((r) => typeof r === 'object' && r !== null && !Number.isNaN((r as { id?: unknown }).id))
    .map((r) => String((r as { name?: string }).name ?? '').trim())
    .filter(Boolean)
  return names.length > 0 ? names : undefined
}

/** 清洗后的名称列表；全部洗空时返回 undefined（前台据此省略该区块）。
 * 名称统一经 shared/post-utils 的 sanitizeTerm（与前台 payload-api 同一份实现）做 URL 段安全。 */
function namesOfSanitized(
  refs?: Array<{ name: string } | number> | { name?: string } | number | null | undefined,
): string[] | undefined {
  const raw = namesOf(refs)
  if (!raw) return undefined
  const cleaned = raw.map(sanitizeTerm).filter((n) => n.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * 「分类标识」(slug) 列表，下标与 categories 严格对齐（后台 Categories 的 slug 是可选字段）。
 * slug 缺失的位置放空串而不是跳过，否则 slug 会错配到别的分类上；
 * 全空时返回 undefined，前台 getPostCategorySegment 会回退到分类名。
 */
function slugsOf(
  refs?: Array<{ slug?: string; id?: unknown } | number> | { slug?: string; id?: unknown } | number | null | undefined,
): string[] | undefined {
  if (!refs) return undefined
  const arr = Array.isArray(refs) ? refs : [refs]
  if (arr.length === 0) return undefined
  const slugs = arr
    .filter((r) => typeof r === 'object' && r !== null && !Number.isNaN((r as { id?: unknown }).id))
    .map((r) => String((r as { slug?: string }).slug ?? '').trim())
  return slugs.some(Boolean) ? slugs : undefined
}

/** 把「每行一个」的文本拆为数组（keywords/ai/tags 字段） */
function linesOf(text?: string | null): string[] | undefined {
  if (!text) return undefined
  const list = String(text)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

/**
 * 取 URL 的路径部分作为归一化 key：去掉协议+域名、去掉 hash 后缀
 *
 * @param url 原始 URL 字符串（可能是绝对 http(s) 或相对路径）
 * @returns 归一化后的路径部分（不含协议、域名、hash），供 altMap 二次命中
 */
function basenameOfUrl(url: string): string {
  let path = url
  try {
    // 支持 http(s) 与协议相对 URL
    if (/^https?:\/\//.test(path)) {
      path = new URL(path).pathname
    }
  } catch {
    // 非法 URL 时按原样处理，只保留相对路径部分
  }
  return path.split('#')[0]
}

/**
 * 归一化 key 集合（与 shared/rehype-img-attrs.mjs、blog payload-api 同口径）：
 * 原值 / 去 # 锚点 / 去 ?query / 纯 path。存多形态，markdown 里带锚点或查询串的
 * 同图也能命中 alt。
 */
function urlNormalizationKeys(url: string): string[] {
  const noHash = url.split('#')[0]
  const noQuery = noHash.split('?')[0]
  let pathOnly = noQuery
  try {
    if (/^https?:\/\//.test(noQuery)) pathOnly = new URL(noQuery).pathname
  } catch {
    // 非法 URL 时按原样处理
  }
  const keys = new Set<string>([url, noHash, noQuery])
  if (pathOnly && pathOnly !== noQuery) keys.add(pathOnly)
  return [...keys]
}

/**
 * 拉取 Media 集合中所有图片，构建 url → alt 映射。
 *
 * 用途：Markdown 正文里 `![](url)` 的图片，Payload 的 MarkdownEditor 上传时
 * 硬编码成 `![](url)`（无 alt）。这里一次性把 Media 集合里人工填写的 alt
 * 反查出来，让 rehypeImgAttrs 插件在渲染时按 url 反查补齐。
 *
 * 封面图片是 Payload 上传后自动填入的 URL，也在同一张 Media 表里，
 * 所以这里返回的 map 同时能匹配「正文图片」和「文章封面」。
 *
 * 性能：单次查库，limit=0 全量拉取；结果被 snapshot 缓存，5s 内不再重查。
 */
export interface MediaAltStats {
  map: Map<string, string>
  /** 配了 alt 的图片条数：删图/删 alt 时 updatedAt 可能不涨，靠条数兜住变化 */
  count: number
  /** 所有图片里最大的 updatedAt：只改 alt 也会变，版本号据此感知 */
  updatedAt?: string
}

export async function fetchMediaAltMap(): Promise<MediaAltStats> {
  const map = new Map<string, string>()
  let count = 0
  let updatedAt: string | undefined
  try {
    const payload = await getDb()
    const { docs } = await payload.find({
      collection: 'media',
      // 只需这几列，减小网络与内存开销；updatedAt 用于计算版本号。
      //
      // ⚠ filename 不能省：@payloadcms/plugin-cloud-storage 的 url 字段是
      // afterRead 钩子按 `data.filename` 现算出来的，不是库里的列。select 里不带
      // filename，钩子拿到 undefined 就跳过生成，url 一律变成 undefined ——
      // 表现是 alt 映射静默为空、正文 ![](url) 永远补不上 alt，而且不报错。
      // （库里 media.url 列存的是建库时的旧值，与这里的结果无关。）
      select: { url: true, alt: true, filename: true, updatedAt: true },
      limit: 0,
    })
    for (const doc of docs as any[]) {
      const stamp: string | undefined = doc?.updatedAt
      if (stamp && (!updatedAt || new Date(stamp) > new Date(updatedAt))) updatedAt = stamp
      const url: string | undefined = doc?.url
      const alt: string | undefined = typeof doc?.alt === 'string' ? doc.alt.trim() : undefined
      if (url && alt) {
        count += 1
        // 归一化 key：Payload 存的是绝对/相对 URL，前台可能拼接域名；
        // 原样 + 多形态（去锚点/去查询/纯 path）各存一份，命中率更高
        for (const key of urlNormalizationKeys(url)) map.set(key, alt)
        // 兜底：按路径 basename（去掉域名前缀、去掉 hash 后缀）再存一份，
        // 让 markdown 里的相对路径、Payload 里的绝对路径能互相命中
        map.set(basenameOfUrl(url), alt)
      }
    }
  } catch (err) {
    console.warn('[blog-sync] 拉取 Media alt 映射失败，回退到无 alt 渲染:', (err as Error).message)
  }
  return { map, count, updatedAt }
}

/** 拉取全部已发布文章，按数字 id 作为条目 id（与前台路径一致） */
export async function fetchPosts(): Promise<MdEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({
    collection: 'posts',
    depth: 1,
    limit: 0,
    sort: '-sticky,-createdAt',
    // status 过滤下沉到 DB 层：limit:0 配合 JS 过滤时，草稿的整篇正文也会被拖进内存
    where: { status: { equals: 'published' } },
    // select 只取渲染所需列（实测 select 对 categories/tags 关系仍会正常 populate 出 name）
    select: {
      title: true,
      description: true,
      cover: true,
      categories: true,
      tags: true,
      keywords: true,
      ai: true,
      sticky: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return docs.map((doc: any) => ({
    // id 使用数字主键：前台用「分类 + 数字 ID」拼路径
    id: String(doc.id),
    data: {
      title: doc.title,
      description: doc.description ?? undefined,
      date: String(doc.createdAt),
      cover: doc.cover ?? undefined,
      // 数字 ID 挂在 data.id 上，postBlocks 用它从 URL 里精确匹配
      id: String(doc.id),
      // 分类/标签名做 URL 段安全清洗（带 / # % 的后台脏值会让路由 404）
      categories: namesOfSanitized(doc.categories),
      // 与 categories 下标对齐的分类标识：文章 URL 分类段优先用它（/posts/daily/46）
      categorySlugs: slugsOf(doc.categories),
      tags: namesOfSanitized(doc.tags),
      keywords: linesOf(doc.keywords),
      ai: linesOf(doc.ai),
      sticky: doc.sticky ?? undefined,
    },
    body: doc.content ?? '',
    updatedAt: doc.updatedAt,
  }))
}

/**
 * 拉取全部已发布随笔。
 * id = 「日期前 10 位 + 后台文档 id」：只用日期时同一天的多条随笔会共用同一个 id，
 * 后进 store 的会静默覆盖前一条；apps/blog 侧 payload-api.ts 已改用同一方案，两侧保持一致。
 */
export async function fetchNotes(): Promise<MdEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({
    collection: 'notes',
    depth: 1,
    limit: 0,
    sort: 'date',
    where: { status: { equals: 'published' } },
    select: {
      date: true,
      title: true,
      mood: true,
      tags: true,
      content: true,
      updatedAt: true,
    },
  })

  return docs.map((doc: any) => {
    // date 字段本地 API 返回 ISO 字符串；兜底处理 Date 对象，保证取到 ISO 日期前缀
    const dateStr = doc.date instanceof Date ? doc.date.toISOString() : String(doc.date)
    return {
      id: `${dateStr.slice(0, 10)}-${doc.id}`,
      data: {
        date: doc.date,
        title: doc.title ?? undefined,
        mood: doc.mood ?? undefined,
        tags: namesOfSanitized(doc.tags),
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
    where: { status: { equals: 'published' } },
    select: {
      group: true,
      groupDescription: true,
      title: true,
      owner: true,
      description: true,
      icon: true,
      href: true,
      articleHref: true,
      stars: true,
      tags: true,
      sortOrder: true,
      updatedAt: true,
    },
  })

  return docs.map((doc: any) => ({
    id: String(doc.id),
    group: doc.group,
    groupDescription: doc.groupDescription ?? undefined,
    title: doc.title,
    owner: doc.owner ?? undefined,
    description: doc.description ?? undefined,
    icon: doc.icon ?? DEFAULT_PROJECT_ICON,
    href: doc.href ?? undefined,
    articleHref: doc.articleHref ?? undefined,
    stars: Number(doc.stars ?? 0),
    tags: linesOf(doc.tags),
    sortOrder: Number(doc.sortOrder ?? 0),
    updatedAt: doc.updatedAt,
  }))
}

/**
 * 拉取全部「已通过」的友链（按 sortOrder 升序）。
 *
 * 与 fetchProjects 同一套口径：status=published 才出现在前台。
 * 注意排序只需一维 —— 前台按 group 聚合时保留首次出现顺序，
 * 组内顺序即这里的 sortOrder 顺序，与后台列表看到的顺序一致。
 */
export async function fetchFriends(): Promise<FriendEntry[]> {
  const payload = await getDb()
  const { docs } = await payload.find({
    collection: 'friends',
    limit: 0,
    sort: 'sortOrder',
    depth: 0,
    where: { status: { equals: 'published' } },
    select: {
      name: true,
      url: true,
      description: true,
      avatar: true,
      group: true,
      groupDescription: true,
      note: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return docs.map((doc: any) => ({
    id: String(doc.id),
    name: String(doc.name ?? ''),
    url: String(doc.url ?? ''),
    description: doc.description ?? undefined,
    avatar: doc.avatar ?? undefined,
    group: String(doc.group ?? '朋友们'),
    groupDescription: doc.groupDescription ?? undefined,
    note: doc.note ?? undefined,
    sortOrder: Number(doc.sortOrder ?? 0),
    createdAt: doc.createdAt,
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

/** 「更多」面板条目（同步用，与前台 payload-api 的 MorePanelItem 同构） */
export interface MorePanelEntry {
  label: string
  href: string
  icon?: string
  external: boolean
}

/** 导航全局原始数据（保留 updatedAt 供版本号计算）；后台不可用时返回 null */
export async function getNavGlobal(): Promise<{
  topNav?: Array<{ label?: string; href?: string; sort?: number | null; visible?: boolean | null }> | null
  morePanel?: Array<{
    label?: string
    href?: string
    icon?: string | null
    external?: boolean | null
    sort?: number | null
    visible?: boolean | null
  }> | null
  updatedAt?: string | null
} | null> {
  try {
    const payload = await getDb()
    const global = await payload.findGlobal({ slug: 'navigation' })
    return global ?? null
  } catch {
    return null
  }
}

/** 后台不可用时的兜底导航（全部站内，无外链） */
const DEFAULT_NAV: Array<{ href: string; label: string; external: boolean }> = [
  { href: '/', label: '首页', external: false },
  { href: '/notes', label: '随笔', external: false },
  { href: '/archive', label: '归档', external: false },
  { href: '/friends', label: '友链', external: false },
  { href: '/about', label: '关于', external: false },
]

/**
 * 后台不可用时的兜底「更多」面板（与前台 site-settings.getMorePanelItems 的离线兜底一致）。
 * 注意 GitHub 这里写的是通用地址：只有后台挂了才走这条，正常情况读库里配置的仓库地址。
 */
const DEFAULT_MORE_PANEL: MorePanelEntry[] = [
  { label: '统计', href: '/stats', icon: 'spark', external: false },
  { label: '标签墙', href: '/tags', icon: 'tag', external: false },
  { label: 'GitHub', href: 'https://github.com', icon: 'github', external: true },
]

/**
 * 从 topNav 数组提取可见的导航项。
 *
 * external 由 href 形态推导而非读库：topNav 表没有 external 列，
 * 凡是完整 URL / mailto: / tel: 都按外链处理，前台注入的链接据此加 target="_blank"。
 */
function parseTopNav(
  items?: Array<{ label?: string; href?: string; sort?: number | null; visible?: boolean | null }> | null,
): Array<{ href: string; label: string; external: boolean }> {
  if (!Array.isArray(items)) return []
  return items
    .filter((i) => i.visible !== false && i.label?.trim() && i.href?.trim())
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    .map((i) => ({
      href: normalizeSiteHref(i.href!.trim()),
      label: i.label!.trim(),
      external: isExternalHref(i.href!),
    }))
}

/** 导航项（Navigation Global 单例）；后台不可用或为空时回退默认四项 */
export async function getNavData(): Promise<Array<{ href: string; label: string; external: boolean }>> {
  const global = await getNavGlobal()
  const items = parseTopNav(global?.topNav)
  return items.length > 0 ? items.filter((item) => item.href && item.label) : DEFAULT_NAV
}

/**
 * 从 morePanel 数组提取可见条目。
 *
 * 与 parseTopNav 同一套口径：过滤 visible === false、label 空、按 sort 升序。
 * 但 href 允许为空 —— 页面还没建时后台可以先只填标题，前台渲染成不可点占位；
 * 所以这里不按 href 过滤（与前台 payload-api.fetchMorePanelItems 一致）。
 */
function parseMorePanel(
  items?: Array<{
    label?: string
    href?: string
    icon?: string | null
    external?: boolean | null
    sort?: number | null
    visible?: boolean | null
  }> | null,
): MorePanelEntry[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((i) => i.visible !== false && i.label?.trim())
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
    .map((i) => ({
      label: i.label!.trim(),
      href: normalizeSiteHref((i.href ?? '').trim()),
      icon: i.icon?.trim() || undefined,
      external: i.external === true,
    }))
}

export interface FetchAllResult {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  friends: FriendEntry[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string; external: boolean }>
  /** 「更多」下拉面板条目；后台不可用时为默认三项 */
  morePanel: MorePanelEntry[]
  navUpdatedAt?: string | null
  /** Media 集合的 url → alt 映射（Markdown 正文图片补 alt 用） */
  mediaAltMap: Map<string, string>
  /** 配了 alt 的图片条数，与 mediaUpdatedAt 一起构成 Media 的变更指纹 */
  mediaCount: number
  mediaUpdatedAt?: string
}

/**
 * 一次性并行拉取全部前台所需数据（7 次查询，覆盖文章/随笔/项目/友链/站点设置/导航/Media alt）
 *
 * 拉取顺序：先并行拉齐 7 份数据，再用 mediaAltMap 回填每篇文章/随笔的 coverAlt。
 * 这样 coverAlt 与正文图片 alt 共用同一份数据源，避免二次查询。
 */
export async function fetchAllData(): Promise<FetchAllResult> {
  const [postsRaw, notesRaw, projects, friends, settings, navGlobal, media] = await Promise.all([
    fetchPosts(),
    fetchNotes(),
    fetchProjects(),
    fetchFriends(),
    getSiteSettingsData(),
    getNavGlobal(),
    fetchMediaAltMap(),
  ])
  const mediaAltMap = media.map

  // 用 altMap 回填 coverAlt：文章/随笔的封面 URL 若在 Media 表里配了 alt，一并带上
  const withCoverAlt = (entries: MdEntry[]) => {
    for (const e of entries) {
      const cover = e.data?.cover
      if (typeof cover === 'string' && cover) {
        const alt = mediaAltMap.get(cover)
        if (alt) e.data.coverAlt = alt
      }
    }
    return entries
  }
  const posts = withCoverAlt(postsRaw)
  const notes = withCoverAlt(notesRaw)

  const items = parseTopNav(navGlobal?.topNav)
  const nav = items.length > 0 ? items.filter((item) => item.href && item.label) : DEFAULT_NAV
  // null = 查询失败（后台不可用）→ 兜底三项，避免面板空掉；
  // [] = 查询成功但后台清空 → 原样返回空数组，尊重「填了才显示」。
  const morePanel = navGlobal === null ? DEFAULT_MORE_PANEL : parseMorePanel(navGlobal.morePanel)
  return {
    posts,
    notes,
    projects,
    friends,
    settings,
    nav,
    morePanel,
    navUpdatedAt: navGlobal?.updatedAt,
    mediaAltMap,
    mediaCount: media.count,
    mediaUpdatedAt: media.updatedAt,
  }
}

/** 时间戳列表中最大的一个；无有效值时返回 undefined */
function maxStamp(stamps: Array<string | number | undefined | null>): number | undefined {
  let max: number | undefined
  for (const s of stamps) {
    if (s === undefined || s === null || s === '') continue
    const t = new Date(s).getTime()
    if (Number.isNaN(t)) continue
    if (max === undefined || t > max) max = t
  }
  return max
}

/**
 * 各数据源的「变更指纹」：条数 + 该源最大 updatedAt。
 *
 * 只给前台一个版本号时，「删掉一篇文章」可能被漏掉（剩下的文档 updatedAt 反而更小），
 * 而条数一定会变。这里把两者拼在一起，供 /api/blog-sync?digest=1 让前台 loader
 * 用极小的响应体判断「这一路数据到底要不要重拉全量」。
 */
export function computeSourceDigests(data: FetchAllResult): Record<string, string> {
  const stampOf = (docs: Array<{ updatedAt?: string }>, count: number) =>
    `${count}:${maxStamp(docs.map((d) => d.updatedAt)) ?? 0}`
  // 两个全局的指纹后缀变更序号：Payload 在「只改 array 字段」时不更新主行 updated_at
  // （见 sync-cache.ts 的 SyncCacheState.mutationSeq 注释），只靠 updatedAt 会让
  // 导航/设置的改动指纹恒定不变。各用自己那一路的序号，发文章不会推动这两路。
  const seq = getMutationSeq()
  return {
    posts: stampOf(data.posts, data.posts.length),
    notes: stampOf(data.notes, data.notes.length),
    projects: stampOf(data.projects, data.projects.length),
    friends: stampOf(data.friends, data.friends.length),
    settings: `${maxStamp([data.settings?.updatedAt]) ?? 0}:${seq.settings}`,
    nav: `${maxStamp([data.navUpdatedAt]) ?? 0}:${seq.nav}`,
    media: `${data.mediaCount}:${maxStamp([data.mediaUpdatedAt]) ?? 0}`,
  }
}

/** 从已查数据计算版本号：各文档/全局 updatedAt 的最大值（毫秒时间戳）+ 各源条数指纹 */
export function computeVersion(data: FetchAllResult): string {
  const digests = computeSourceDigests(data)
  const max = maxStamp([
    ...data.posts.map((p) => p.updatedAt),
    ...data.notes.map((n) => n.updatedAt),
    ...data.projects.map((p) => p.updatedAt),
    ...data.friends.map((f) => f.updatedAt),
    data.settings?.updatedAt,
    data.navUpdatedAt,
    data.mediaUpdatedAt,
  ])
  // 无任何文档时退回当前时间，保持「每次不同」的旧行为
  const stamp = max === undefined ? Date.now() : max
  return `${stamp}:${digests.posts}|${digests.notes}|${digests.projects}|${digests.friends}|${digests.settings}|${digests.nav}|${digests.media}`
}

/**
 * 取同步数据快照：命中缓存直接返回（零查库），否则全量拉取并缓存。
 * afterChange 钩子会清除快照，使下一次调用重新查库拿到最新数据。
 *
 * in-flight single-flight：快照失效瞬间的并发请求（SSE 广播后前台集中重拉 / 多页面同时注入）
 * 复用同一个查询 Promise，避免 N 份「limit:0 全表全正文」并发打库。
 * 挂 globalThis —— 与探针缓存同理：Next 按路由分包，各实例模块变量不互通。
 */
const INFLIGHT_STATE_KEY = '__cloudBlogSyncDataInflight'
const inflightGlobal = globalThis as typeof globalThis & {
  [INFLIGHT_STATE_KEY]?: Promise<SyncSnapshot> | null
}

export async function getSyncData(): Promise<SyncSnapshot> {
  const cached = getSnapshot()
  if (cached) return cached

  const inflight = inflightGlobal[INFLIGHT_STATE_KEY]
  if (inflight) return inflight

  const promise = buildSyncSnapshot().finally(() => {
    // 完成后立即清理；只清自己这一份，防止误清后来者
    if (inflightGlobal[INFLIGHT_STATE_KEY] === promise) {
      inflightGlobal[INFLIGHT_STATE_KEY] = null
    }
  })
  inflightGlobal[INFLIGHT_STATE_KEY] = promise
  return promise
}

async function buildSyncSnapshot(): Promise<SyncSnapshot> {
  const data = await fetchAllData()
  const version = computeVersion(data)
  const digests = computeSourceDigests(data)
  const snapshot: SyncSnapshot = {
    posts: data.posts,
    notes: data.notes,
    projects: data.projects,
    friends: data.friends,
    settings: data.settings,
    nav: data.nav,
    morePanel: data.morePanel,
    navUpdatedAt: data.navUpdatedAt,
    mediaAltMap: data.mediaAltMap,
    // 随快照一起缓存：?digest=1 命中缓存时零重算，直接回给前台
    digests,
    version,
    ts: Date.now(),
  }
  setSnapshot(snapshot)
  // 全量数据刚查完，顺手回填探测缓存：digest 路径接下来无需再查库即可给出一致指纹
  setProbe({ version, digests })
  return snapshot
}

// ---------------------------------------------------------------------------
// 轻量探测（/api/blog-sync?digest=1 / ?version=1）
//
// 前台 loader 每 3s 拉一次 digest；此前该路径复用 getSyncData()，快照一过期
// 就触发「limit:0 全表全正文」的六路全量查询，探测本身成了最大的查库来源。
// 这里改为只查指纹所需的最小数据：每源一个 count + 单行 max updatedAt
// （status 过滤在 DB 层 where 里做，不在 JS 侧过滤），并带独立 TTL 缓存。
// 输出与全量快照的 computeVersion/computeSourceDigests 完全同构（同格式、同语义），
// 保证前台比较 version/digests 字符串时两条路径可互换。
// ---------------------------------------------------------------------------

/**
 * 探测缓存放弃本模块私有的 globalThis 槽位，统一收敛进 sync-cache 的 SyncCacheState：
 * 这样 invalidateAll() 能一并清掉探测缓存（原先漏清，导致 afterChange 后旧指纹仍被
 * ?digest=1 命中），写入也共用同一份 cacheWriteBypassUntil 静默期。
 *
 * TTL 仍由本模块按环境决定（生产 5s / dev 60s）：探测与全量快照的 TTL 取值口径一致。
 */

/** TTL 与快照一致：生产 5s（限流 3s 轮询），dev 放宽避免跨公网反复重查 */
const PROBE_TTL_MS = process.env.NODE_ENV === 'production' ? 5_000 : 60_000

/** 单指纹串的格式化：与 computeSourceDigests 的 stampOf 同构（条数:最大 updatedAt） */
const digestStamp = (count: number, updatedAt?: string): string => `${count}:${maxStamp([updatedAt]) ?? 0}`

async function fetchSyncProbe(): Promise<SyncProbe> {
  const payload = await getDb()
  const publishedWhere = { status: { equals: 'published' } }
  const [posts, notes, projects, friends, media, settings, navGlobal] = await Promise.all([
    payload.find({
      collection: 'posts',
      where: publishedWhere,
      limit: 1,
      sort: '-updatedAt',
      depth: 0,
      select: { updatedAt: true },
    }),
    payload.find({
      collection: 'notes',
      where: publishedWhere,
      limit: 1,
      sort: '-updatedAt',
      depth: 0,
      select: { updatedAt: true },
    }),
    payload.find({
      collection: 'projects',
      where: publishedWhere,
      limit: 1,
      sort: '-updatedAt',
      depth: 0,
      select: { updatedAt: true },
    }),
    payload.find({
      collection: 'friends',
      where: publishedWhere,
      limit: 1,
      sort: '-updatedAt',
      depth: 0,
      select: { updatedAt: true },
    }),
    // Media 直接复用 fetchMediaAltMap：只查 url/alt/updatedAt 三个小列（无正文类大字段），
    // 且「配了 alt 的条数 + 全表最大 updatedAt」口径与快照路径逐字一致 ——
    // url 是 upload 集合的读时派生列，SQL where 无法精确复现其语义，
    // 宁可多扫几行小列，也要保证 digest 路径与全量路径的指纹永远相等（否则前台每轮都会误判变化重拉全量）。
    fetchMediaAltMap(),
    payload.findGlobal({ slug: 'site-settings', select: { updatedAt: true } }),
    payload.findGlobal({ slug: 'navigation', select: { updatedAt: true } }),
  ])

  const seq = getMutationSeq()
  const digests = {
    posts: digestStamp(posts.totalDocs, posts.docs[0]?.updatedAt),
    notes: digestStamp(notes.totalDocs, notes.docs[0]?.updatedAt),
    projects: digestStamp(projects.totalDocs, projects.docs[0]?.updatedAt),
    friends: digestStamp(friends.totalDocs, friends.docs[0]?.updatedAt),
    // 与 computeSourceDigests 逐字同构：末尾追加该源的变更序号，补上「只改 array 字段时
    // updated_at 不更新」导致的指纹不变（详见 computeSourceDigests 与 sync-cache.ts）。
    settings: `${maxStamp([(settings as { updatedAt?: string })?.updatedAt]) ?? 0}:${seq.settings}`,
    nav: `${maxStamp([(navGlobal as { updatedAt?: string })?.updatedAt]) ?? 0}:${seq.nav}`,
    media: digestStamp(media.count, media.updatedAt),
  }

  // 与 computeVersion 完全同构：总 max + 各源指纹拼接（无任何数据时退回当前时间，保持旧行为）
  const max = maxStamp([
    posts.docs[0]?.updatedAt,
    notes.docs[0]?.updatedAt,
    projects.docs[0]?.updatedAt,
    friends.docs[0]?.updatedAt,
    (settings as { updatedAt?: string })?.updatedAt,
    (navGlobal as { updatedAt?: string })?.updatedAt,
    media.updatedAt,
  ])
  const stamp = max === undefined ? Date.now() : max
  const version = `${stamp}:${digests.posts}|${digests.notes}|${digests.projects}|${digests.friends}|${digests.settings}|${digests.nav}|${digests.media}`
  return { version, digests }
}

/** 带 TTL 的探测数据：3s 轮询下绝大多数请求零查库直接命中 */
export async function getSyncProbe(): Promise<SyncProbe> {
  const stored = getProbe()
  if (stored && Date.now() - stored.ts <= PROBE_TTL_MS) return stored.probe
  const probe = await fetchSyncProbe()
  setProbe(probe)
  return probe
}
