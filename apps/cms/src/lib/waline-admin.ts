import { createRequire } from 'node:module'
import { Client } from 'pg'
import { forwardToWaline } from './waline-bridge'

/**
 * 后台评论管理的服务端入口：以「管理员身份」调用进程内 Waline。
 *
 * 为什么不直接查 wl_comment 表：属地/浏览器/系统/头像这些展示字段是 Waline 在
 * 格式化阶段算出来的，审核动作还带着限频、通知、状态机副作用。绕开它的 API 就等于
 * 复制一份逻辑，Waline 一升级就漂移。
 *
 * 为什么不建一个有密码的 Waline 账号让后台登录：多一个凭据要管（env 里明文放密码，
 * 泄露面比「服务端用已有密钥自签令牌」大）。这里用 Waline 自己的签名密钥铸一枚短期
 * 令牌，密钥本来就在 env 里，令牌只在进程内使用、绝不下发给浏览器。
 *
 * 前提：Waline 校验令牌后会按 id 回查 wl_users（见 core 的 resolveSession），
 * 所以库里必须存在一行 administrator。ensureAdminAccountId() 首次调用时补一行
 * 「无密码服务账号」——password 为空即无法从外部登录，只有能读 JWT_TOKEN 的服务端能用它。
 */

type Jwt = {
  sign(payload: string | number | object, secret: string, options?: object): string
}

// jsonwebtoken 是 CJS；Next 服务端打包对它的静态解析没问题，但为与 waline-bridge 一致仍用 createRequire
const require_ = createRequire(import.meta.url)
const jwt = require_('jsonwebtoken') as Jwt

const ADMIN_EMAIL = 'cms-moderation@invalid.local'

/** Waline 的 listForAdmin 支持的状态过滤（approved = 既非 waiting 也非 spam） */
export type WalineStatus = 'waiting' | 'approved' | 'spam' | 'all'

/** 后台列表行（已归一化，comment 用原始 markdown 文本，不给 HTML） */
export interface WalineComment {
  id: number
  nick: string
  mail: string
  link: string
  url: string
  text: string
  status: string
  like: number
  createdAt: string | null
  addr: string
  browser: string
  os: string
  avatar: string
  parentId: number | null
  rootId: number | null
}

/** 表格行：根评论 + 它的回复树（回复按时间正序，见 buildThreads） */
export type WalineCommentNode = WalineComment & {
  replies: WalineCommentNode[]
  /** 后代总数，不是本页条数：用于行首箭头的「有回复」判断 */
  replyCount: number
}

export interface WalineListResult {
  rows: WalineCommentNode[]
  page: number
  totalPages: number
  pageSize: number
  /** 命中线程数（分页单位是线程，不是单条评论） */
  total: number
  waitingCount: number
  spamCount: number
}

interface WalineEnvelope<T> {
  errno: number
  errmsg?: string
  data?: T
}

class WalineAdminError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

let adminId: number | null = null

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DATABASE ?? '',
    user: process.env.POSTGRES_USER ?? '',
    password: process.env.POSTGRES_PASSWORD ?? '',
    ssl: process.env.POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

/** 取（必要时创建）一个 administrator 账号 id，作为铸令牌的主体 */
async function ensureAdminAccountId(): Promise<number> {
  if (adminId) return adminId

  const prefix = process.env.POSTGRES_PREFIX ?? 'wl_'
  if (!/^[a-z_][a-z0-9_]*$/i.test(prefix)) throw new WalineAdminError('POSTGRES_PREFIX 不合法')
  const users = `${prefix}users`

  const id = await withDb(async (client) => {
    const found = await client.query(
      `SELECT id FROM "${users}" WHERE type = 'administrator' ORDER BY id LIMIT 1`,
    )
    if (found.rowCount) return Number(found.rows[0].id)

    const inserted = await client.query(
      `INSERT INTO "${users}" (display_name, email, type, createdat, updatedat)
       VALUES ($1, $2, 'administrator', now(), now()) RETURNING id`,
      ['CMS 审核服务', ADMIN_EMAIL],
    )
    return Number(inserted.rows[0].id)
  })

  adminId = id
  return id
}

function mintAdminToken(): string {
  const key = process.env.JWT_TOKEN
  if (!key) throw new WalineAdminError('未配置 JWT_TOKEN，后台无法访问评论服务', 500)
  return jwt.sign(String(adminId!), key)
}

/**
 * 以管理员身份调用 Waline。走 forwardToWaline 复用同一套请求/响应搬运逻辑
 * （含 X-Forwarded-* 处理），只是这里的 Request 是服务端自造的、不出网关。
 */
async function callWaline<T>(
  path: string,
  {
    method = 'GET',
    query,
    body,
  }: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  await ensureAdminAccountId()
  const search = query ? new URLSearchParams(query).toString() : ''
  const headers: Record<string, string> = { authorization: `Bearer ${mintAdminToken()}` }
  if (body !== undefined) headers['content-type'] = 'application/json'

  const request = new Request(`http://waline.internal${path}${search ? `?${search}` : ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const response = await forwardToWaline(path, search, request)
  const json = (await response.json().catch(() => null)) as WalineEnvelope<T> | null
  if (!response.ok) {
    throw new WalineAdminError(`评论服务返回异常（HTTP ${response.status}）`, 502)
  }
  if (!json || json.errno !== 0) {
    throw new WalineAdminError(json?.errmsg || '评论服务拒绝了该操作', 400)
  }
  return json.data as T
}

interface RawAdminComment {
  objectId?: number
  nick?: string | null
  mail?: string | null
  link?: string | null
  url?: string
  comment?: string
  orig?: string
  status?: string
  like?: number | null
  insertedat?: string | null
  time?: number | null
  addr?: string
  browser?: string
  os?: string
  avatar?: string
  pid?: number | null
  rid?: number | null
}

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

const normalize = (raw: RawAdminComment): WalineComment => ({
  id: Number(raw.objectId),
  nick: (raw.nick ?? '').trim() || '匿名',
  mail: raw.mail ?? '',
  link: raw.link ?? '',
  url: raw.url ?? '',
  // 后台只展示原始文本：Waline 的 comment 字段是服务端渲染好的 HTML，直接塞进后台
  // 就等于把访客可控的 HTML 注入管理员页面。orig 是提交时的原文。
  text: raw.orig?.trim() || stripHtml(raw.comment ?? ''),
  status: raw.status ?? '',
  like: Number(raw.like ?? 0) || 0,
  createdAt: raw.insertedat ?? (raw.time ? new Date(Number(raw.time)).toISOString() : null),
  addr: raw.addr ?? '',
  browser: raw.browser ?? '',
  os: raw.os ?? '',
  avatar: raw.avatar ?? '',
  parentId: raw.pid ?? null,
  rootId: raw.rid ?? null,
})

/**
 * 后台评论管理只服务「文章评论」：Waline 的 url 是提交页路径（文章页形如 /posts/xxx/，
 * 随笔在 /notes/ 下），列表接口没有路径过滤参数，只能整量取回后在进程内过滤。
 * Waline 是进程内转发，取全量的成本可忽略；上限 FETCH_MAX_PAGES 防止极端数据下打爆循环。
 */
const POSTS_PATH_PREFIX = '/posts'
const FETCH_PAGE_SIZE = 100
const FETCH_MAX_PAGES = 50

/** url 可能是完整地址也可能是裸路径，统一取 pathname 再判断 */
function isPostComment(url: string): boolean {
  if (!url) return false
  let pathname = url
  try {
    pathname = new URL(url, 'http://local').pathname
  } catch {
    // 解析失败时按原串判断，宁可多算也别丢评论
  }
  return pathname === POSTS_PATH_PREFIX || pathname.startsWith(`${POSTS_PATH_PREFIX}/`)
}

/** 无过滤条件整量拉取（分页循环），返回规范化后的评论 */
async function fetchAllComments(): Promise<WalineComment[]> {
  const rows: WalineComment[] = []
  let page = 1
  let totalPages = 1
  do {
    const data = await callWaline<{ totalPages?: number; data?: RawAdminComment[] }>('/api/comment', {
      query: { type: 'list', page: String(page), pageSize: String(FETCH_PAGE_SIZE) },
    })
    rows.push(...(data?.data ?? []).map(normalize))
    totalPages = Math.min(Number(data?.totalPages ?? 0) || 1, FETCH_MAX_PAGES)
    page += 1
  } while (page <= totalPages)
  return rows
}

/** 无时间戳（异常数据）落到 0：不带日期筛选时照常展示，带日期筛选则不命中 */
const timeOf = (item: WalineComment) => {
  const ts = item.createdAt ? new Date(item.createdAt).getTime() : NaN
  return Number.isNaN(ts) ? 0 : ts
}

const matchesFilters = (
  item: WalineComment,
  status: WalineStatus,
  keyword: string,
  fromTs: number,
  toTs: number,
) => {
  if (status === 'waiting' && item.status !== 'waiting') return false
  if (status === 'spam' && item.status !== 'spam') return false
  if (status === 'approved' && (item.status === 'waiting' || item.status === 'spam')) return false
  if (keyword && !item.text.toLowerCase().includes(keyword)) return false
  const ts = timeOf(item)
  return ts >= fromTs && ts <= toTs
}

/**
 * 扁平评论 → 「根评论 + 回复」森林。根按时间倒序，回复按时间正序。
 *
 * 只认 id 更小的父级：Waline 的 pid 永远指向先入库的那条，这一条判据顺带挡掉脏数据里
 * 父子互指的情况（否则那条线程会从所有根上同时消失，且 replyCount 递归不收敛）。
 */
function buildThreads(items: WalineComment[]): WalineCommentNode[] {
  const nodes = new Map<number, WalineCommentNode>()
  for (const item of items) nodes.set(item.id, { ...item, replies: [], replyCount: 0 })

  const roots: WalineCommentNode[] = []
  for (const node of [...nodes.values()].sort((a, b) => timeOf(a) - timeOf(b))) {
    const parent = node.parentId != null ? nodes.get(node.parentId) : undefined
    if (parent && parent.id < node.id) parent.replies.push(node)
    else roots.push(node)
  }

  const countDeep = (node: WalineCommentNode): number =>
    node.replies.reduce((sum, child) => sum + 1 + countDeep(child), 0)
  for (const node of nodes.values()) node.replyCount = countDeep(node)

  return roots.sort((a, b) => timeOf(b) - timeOf(a))
}

export async function listComments(options: {
  status: WalineStatus
  page: number
  pageSize: number
  keyword?: string
  /** YYYY-MM-DD；按服务器本地时区取整天边界，后台填的是「哪天」而不是 UTC 零点 */
  from?: string
  to?: string
}): Promise<WalineListResult> {
  const posts = (await fetchAllComments()).filter((item) => isPostComment(item.url))

  // 角标计数只认文章评论，且不随关键词/日期变化（是队列水位，不是搜索结果数）
  const waitingCount = posts.filter((item) => item.status === 'waiting').length
  const spamCount = posts.filter((item) => item.status === 'spam').length

  const keyword = options.keyword?.trim().toLowerCase() ?? ''
  const fromTs = options.from ? new Date(`${options.from}T00:00:00`).getTime() : -Infinity
  const toTs = options.to ? new Date(`${options.to}T23:59:59.999`).getTime() : Infinity
  const hit = (item: WalineComment) => matchesFilters(item, options.status, keyword, fromTs, toTs)
  // 线程级命中：自身或任一后代符合即保留整条线程（回复各自带状态胶囊）。
  // 只按根评论过滤会把「已通过父 + 待审子」这类回复永久藏起来，等于漏审。
  const threadHit = (node: WalineCommentNode): boolean => hit(node) || node.replies.some(threadHit)

  const matched = buildThreads(posts).filter(threadHit)

  const pageSize = Math.max(1, options.pageSize)
  const totalPages = Math.ceil(matched.length / pageSize)
  const page = Math.min(Math.max(1, options.page), Math.max(1, totalPages))
  const start = (page - 1) * pageSize

  return {
    rows: matched.slice(start, start + pageSize),
    page,
    totalPages,
    pageSize,
    total: matched.length,
    waitingCount,
    spamCount,
  }
}

/** 改状态：approved 上线、spam 收进垃圾箱、waiting 退回待审 */
export async function setCommentStatus(id: number, status: 'approved' | 'spam' | 'waiting') {
  // 只送 status：controller 把 body 整个当作更新数据（data = {...input.data}），
  // 多余的 objectId 会作为待写入列回到同一条 UPDATE 里。
  return callWaline<RawAdminComment>(`/api/comment/${id}`, {
    method: 'PUT',
    query: { id: String(id) },
    body: { status },
  })
}

export async function removeComment(id: number) {
  return callWaline<unknown>(`/api/comment/${id}`, {
    method: 'DELETE',
    query: { id: String(id) },
  })
}

export { WalineAdminError }
