import { Client } from 'pg'
import { resolvePgTls } from './pg-tls'
import { identityOf, lookupAddrs } from './comment-identity'
import {
  WalineServerError,
  ensureAdminAccount,
  table,
  withDb,
  type RawComment,
} from './waline-server'

/**
 * 后台评论管理 —— 直接操作 wl_* 表，不再通过 HTTP 转发 Waline。
 *
 * 原来走 forwardToWaline 的原因是「Waline 格式化属地/UA/头像、审核带副作用」。
 * 现在评论服务就是自己写的，这些逻辑直接在 SQL 层处理，少一层故障面。
 */

export type WalineStatus = 'waiting' | 'approved' | 'spam' | 'all'

export interface WalineComment {
  id: number
  nick: string
  mail: string
  link: string
  url: string
  text: string
  images: string[]
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

export type WalineCommentNode = WalineComment & {
  replies: WalineCommentNode[]
  replyCount: number
}

export interface WalineListResult {
  rows: WalineCommentNode[]
  page: number
  totalPages: number
  pageSize: number
  total: number
  waitingCount: number
  spamCount: number
  truncated?: boolean
}

const ADMIN_EMAIL = 'cms-moderation@invalid.local'

// ==================== 连接（复用 waline-server 的 withDb） ====================
// 直接 import { withDb } from './waline-server'，已在顶部。

// ==================== 规范化 ====================

interface RawAdminComment {
  id: number
  nick?: string | null
  mail?: string | null
  link?: string | null
  url?: string
  comment?: string | null
  status?: string
  like?: number | null
  insertedat?: string | null
  createdat?: string | null
  pid?: number | null
  rid?: number | null
  ua?: string | null
  ip?: string | null
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

/**
 * 从评论正文提取配图地址（HTML <img src> + markdown ![](url)）。
 * 只保留 http(s) 与站内路径，丢弃 javascript:/data:。
 */
function extractImages(raw: RawAdminComment): string[] {
  const found = new Set<string>()
  const push = (value: string | undefined) => {
    if (!value) return
    const url = value.trim().replace(/&amp;/g, '&')
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) found.add(url)
  }
  const imgRe = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi
  for (let m = imgRe.exec(raw.comment ?? ''); m; m = imgRe.exec(raw.comment ?? '')) push(m[1])
  return [...found].slice(0, 12)
}

const normalize = (raw: RawAdminComment): WalineComment => {
  const identity = identityOf(raw)
  return {
    id: raw.id,
    nick: (raw.nick ?? '').trim() || '匿名',
    mail: raw.mail ?? '',
    link: raw.link ?? '',
    url: raw.url ?? '',
    text: stripHtml(raw.comment ?? ''),
    images: extractImages(raw),
    status: raw.status ?? '',
    like: Number(raw.like ?? 0) || 0,
    createdAt: raw.insertedat ?? raw.createdat ?? null,
    addr: '',
    browser: identity.browser,
    os: identity.os,
    avatar: identity.avatar,
    parentId: raw.pid ?? null,
    rootId: raw.rid ?? null,
  }
}

// ==================== 列表 ====================

const POSTS_PATH_PREFIX = '/posts'

function isPostComment(url: string): boolean {
  if (!url) return false
  let pathname = url
  try {
    pathname = new URL(url, 'http://local').pathname
  } catch {
    /* 解析失败按原串 */
  }
  return pathname === POSTS_PATH_PREFIX || pathname.startsWith(`${POSTS_PATH_PREFIX}/`)
}

/**
 * 后台列表：直接 SQL 查 wl_comment，过滤文章评论，按线程组装。
 *
 * 与原 Waline 版的差异：不再分页拉取（Waline 每页最多 100 条、最多 50 页），
 * 而是一次性把所有文章评论取回（通常几百条），在进程内过滤/组装/分页。
 * 数据量大了再加分页 SQL。
 */
export async function listComments(options: {
  status: WalineStatus
  page: number
  pageSize: number
  keyword?: string
  from?: string
  to?: string
}): Promise<WalineListResult> {
  const { rows: all, ips } = await withDb(async (client) => {
    const result = await client.query(
      `SELECT id, nick, mail, link, url, comment, status, "like", insertedat, createdat, pid, rid, ua, ip
       FROM ${table('comment')}
       ORDER BY createdat DESC`,
    )
    const raw = result.rows as RawAdminComment[]
    // ip 单独留着：normalize 出来的对象不带 ip（后台界面不展示 IP），
    // 但属地回填需要它来查
    const ipMap = new Map<number, string>()
    for (const item of raw) ipMap.set(item.id, item.ip ?? '')
    return { rows: raw.map(normalize), ips: ipMap }
  })

  const posts = all.filter((item) => isPostComment(item.url))

  // 角标计数
  const waitingCount = posts.filter((item) => item.status === 'waiting').length
  const spamCount = posts.filter((item) => item.status === 'spam').length

  const keyword = options.keyword?.trim().toLowerCase() ?? ''
  const fromTs = options.from ? new Date(`${options.from}T00:00:00`).getTime() : -Infinity
  const toTs = options.to ? new Date(`${options.to}T23:59:59.999`).getTime() : Infinity

  const matchesFilters = (item: WalineComment) => {
    if (options.status === 'waiting' && item.status !== 'waiting') return false
    if (options.status === 'spam' && item.status !== 'spam') return false
    if (options.status === 'approved' && (item.status === 'waiting' || item.status === 'spam')) return false
    if (keyword && !item.text.toLowerCase().includes(keyword)) return false
    const ts = item.createdAt ? new Date(item.createdAt).getTime() : 0
    return ts >= fromTs && ts <= toTs
  }

  // 组装线程
  const buildThreads = (items: WalineComment[]): WalineCommentNode[] => {
    const nodes = new Map<number, WalineCommentNode>()
    for (const item of items) nodes.set(item.id, { ...item, replies: [], replyCount: 0 })
    const roots: WalineCommentNode[] = []
    for (const node of [...nodes.values()].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return ta - tb
    })) {
      const parent = node.parentId != null ? nodes.get(node.parentId) : undefined
      if (parent && parent.id < node.id) parent.replies.push(node)
      else roots.push(node)
    }
    const countDeep = (node: WalineCommentNode): number =>
      node.replies.reduce((sum, child) => sum + 1 + countDeep(child), 0)
    for (const node of nodes.values()) node.replyCount = countDeep(node)
    return roots.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
  }

  const threadHit = (node: WalineCommentNode): boolean =>
    matchesFilters(node) || node.replies.some(threadHit)

  const matched = buildThreads(posts).filter(threadHit)

  const pageSize = Math.max(1, options.pageSize)
  const totalPages = Math.ceil(matched.length / pageSize)
  const page = Math.min(Math.max(1, options.page), Math.max(1, totalPages))
  const start = (page - 1) * pageSize
  const rows = matched.slice(start, start + pageSize)

  // 只给本页的评论查属地：全量几百条都查会把后台列表拖到十几秒
  const pageThunks: WalineComment[] = []
  const collect = (node: WalineCommentNode) => {
    pageThunks.push(node)
    for (const child of node.replies) collect(child)
  }
  for (const node of rows) collect(node)
  if (pageThunks.length) {
    const addrMap = await lookupAddrs(pageThunks.map((item) => ips.get(item.id)))
    for (const item of pageThunks) {
      item.addr = addrMap.get(String(ips.get(item.id) ?? '').trim()) ?? ''
    }
  }

  return {
    rows,
    page,
    totalPages,
    pageSize,
    total: matched.length,
    waitingCount,
    spamCount,
    truncated: false,
  }
}

// ==================== 审核 / 删除 / 回复 ====================

export async function setCommentStatus(id: number, status: 'approved' | 'spam' | 'waiting') {
  return withDb(async (client) => {
    const result = await client.query(
      `UPDATE ${table('comment')} SET status = $1, updatedat = now() WHERE id = $2 RETURNING id`,
      [status, id],
    )
    if (!result.rowCount) throw new WalineServerError('评论不存在', 404)
  })
}

export async function removeComment(id: number) {
  return withDb(async (client) => {
    // 先删子回复，再删自己
    await client.query(`DELETE FROM ${table('comment')} WHERE pid = $1 OR rid = $1`, [id])
    await client.query(`DELETE FROM ${table('comment')} WHERE id = $1`, [id])
  })
}

/**
 * 以站长身份回复评论（直接 approved）。
 */
export async function replyToComment(options: {
  parentId: number
  url: string
  content: string
  nick: string
}) {
  const content = options.content.trim()
  if (!content) throw new WalineServerError('回复内容不能为空', 400)
  if (!options.url.trim()) throw new WalineServerError('这条评论缺少所属文章地址，无法回复', 400)

  const adminId = await ensureAdminAccount(ADMIN_EMAIL, 'CMS 审核服务')

  return withDb(async (client) => {
    // 查父评论取 rid（根评论 id）
    const parent = await client.query(
      `SELECT id, rid, url FROM ${table('comment')} WHERE id = $1`,
      [options.parentId],
    )
    if (!parent.rowCount) throw new WalineServerError('被回复的评论不存在', 404)
    const rid = parent.rows[0].rid ?? parent.rows[0].id

    const result = await client.query(
      `INSERT INTO ${table('comment')}
       (user_id, comment, nick, mail, link, url, pid, rid, status, ua, ip, "like", insertedat, createdat, updatedat)
       VALUES ($1, $2, $3, $4, '', $5, $6, $7, 'approved', '', '', 0, now(), now(), now())
       RETURNING id, status`,
      [adminId, content, options.nick.trim() || '站长', ADMIN_EMAIL, options.url, options.parentId, rid],
    )
    return {
      id: Number(result.rows[0].id),
      status: result.rows[0].status,
    }
  })
}

// ==================== 导出 CSV ====================

/**
 * 导出文章评论为 CSV（功能 #25）。
 * 供后台「导出」按钮调用，返回 CSV 文本。
 */
export async function exportCommentsCsv(options: {
  status?: WalineStatus
}): Promise<string> {
  const all = await withDb(async (client) => {
    let query = `SELECT id, nick, mail, link, url, comment, status, "like", insertedat, createdat, pid, rid, ua
                 FROM ${table('comment')} ORDER BY createdat DESC`
    if (options.status && options.status !== 'all') {
      query = `SELECT id, nick, mail, link, url, comment, status, "like", insertedat, createdat, pid, rid, ua
               FROM ${table('comment')} WHERE status = $1 ORDER BY createdat DESC`
      const result = await client.query(query, [options.status])
      return result.rows as RawAdminComment[]
    }
    const result = await client.query(query)
    return result.rows as RawAdminComment[]
  })

  const header = ['id', 'nick', 'mail', 'link', 'url', 'comment', 'status', 'like', 'createdat', 'pid', 'rid']
  const escape = (v: unknown) => {
    const s = String(v ?? '').replace(/"/g, '""')
    return /[",\n]/.test(s) ? `"${s}"` : s
  }
  const lines = [header.join(',')]
  for (const row of all) {
    lines.push([
      row.id,
      row.nick,
      row.mail,
      row.link,
      row.url,
      stripHtml(row.comment ?? ''),
      row.status,
      row.like,
      row.insertedat ?? row.createdat,
      row.pid,
      row.rid,
    ].map(escape).join(','))
  }
  return lines.join('\n')
}

export { WalineServerError as WalineAdminError }
