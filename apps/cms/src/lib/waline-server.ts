/**
 * 评论服务核心 —— 自写轻量版 Waline 兼容 API。
 *
 * 为什么不用 @waline/vercel：
 *   - 它的运行时闭包 131.9 MiB（LeanCloud 34M、better-sqlite3 11M、thinkjs 生态…），
 *     超过 EdgeOne 函数 128 MiB 硬限额；且 thinkjs 用 fs.readdirSync + 动态 require
 *     加载 service，在打包型环境下极易断裂。
 *   - 本模块只实现博客实际用到的能力（评论 CRUD、点赞、计数、recent、审核），
 *     用 pg 直连 wl_* 表，不引入任何第三方评论框架。
 *
 * 设计原则：
 *   - 完全兼容 @waline/client v3 的 API 形状（{errno, errmsg?, data} 信封）。
 *   - 存储沿用 apps/cms/scripts/waline/schema.sql 的 wl_comment / wl_counter / wl_users。
 *   - 连接串从 POSTGRES_URL 派生，复用 pg-tls.ts 的 TLS 策略（与 Payload 主连接一致）。
 *   - 走 Supabase 6543 事务池（避免 5432 session 池 15 连接被打满）。
 */

import { createRequire } from 'node:module'
import { Client } from 'pg'
import { resolvePgTls } from './pg-tls'
import { rateLimitIp, hitForbiddenWords, akismetCheck } from './waline-anti-spam'
import { identityOf, lookupAddr, lookupAddrs } from './comment-identity'

const require_ = createRequire(import.meta.url)
// sanitize-html 是 CJS，用 createRequire 加载避免打包器静态分析问题
let sanitizeHtml: ((html: string, options?: unknown) => string) | null = null
try {
  sanitizeHtml = require_('sanitize-html') as (html: string, options?: unknown) => string
} catch {
  sanitizeHtml = null
}

export class WalineServerError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** 表前缀，默认 wl_，可通过 POSTGRES_PREFIX 覆盖 */
const PREFIX = process.env.POSTGRES_PREFIX ?? 'wl_'

export function table(name: string) {
  return `${PREFIX}${name}`
}

/** 评论连接串：优先 POSTGRES_URL，回落拆分变量 */
function walineConnectionString(): string | undefined {
  if (process.env.POSTGRES_URL) {
    // Supabase 6543 事务池：把 5432 改成 6543，避免 session 池 15 连接打满
    return process.env.POSTGRES_URL.replace(':5432/', ':6543/')
  }
  const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD } = process.env
  if (!POSTGRES_HOST) return undefined
  const auth = POSTGRES_USER
    ? `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD ?? '')}@`
    : ''
  return `postgresql://${auth}${POSTGRES_HOST}:${POSTGRES_PORT ?? 5432}/${POSTGRES_DATABASE ?? ''}`
}

/** 获取一个 pg 连接，用完自动关闭 */
export async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const plan = resolvePgTls({
    connectionString: walineConnectionString(),
    insecure: process.env.PG_SSL_INSECURE === '1',
    caFile: process.env.SUPABASE_CA_FILE,
    localSsl: process.env.PG_LOCAL_SSL === '1',
  })
  if (!plan.connectionString) {
    throw new WalineServerError('未配置 POSTGRES_URL / POSTGRES_HOST，评论服务不可用', 500)
  }
  const client = new Client({
    connectionString: plan.connectionString,
    ...(plan.ssl !== undefined ? { ssl: plan.ssl } : {}),
  })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

// ==================== 数据类型 ====================

export interface RawComment {
  id: number
  user_id: number | null
  comment: string | null
  insertedat: Date | null
  ip: string | null
  link: string | null
  mail: string | null
  nick: string | null
  pid: number | null
  rid: number | null
  sticky: string | number | null
  status: string
  like: number | null
  ua: string | null
  url: string | null
  createdat: Date | null
  updatedat: Date | null
}

export interface RawCounter {
  id: number
  time: number | null
  reaction0: number | null
  reaction1: number | null
  reaction2: number | null
  reaction3: number | null
  reaction4: number | null
  reaction5: number | null
  reaction6: number | null
  reaction7: number | null
  reaction8: number | null
  url: string
}

/** 规范化为 @waline/client 期望的字段名（objectId 而非 id） */
export function normalizeComment(raw: RawComment, addr = '') {
  const time = raw.insertedat ?? raw.createdat
  const identity = identityOf(raw)
  return {
    objectId: raw.id,
    user_id: raw.user_id,
    nick: raw.nick ?? '匿名',
    link: raw.link ?? '',
    url: raw.url ?? '',
    comment: raw.comment ?? '',
    status: raw.status ?? '',
    like: Number(raw.like ?? 0),
    sticky: raw.sticky ? Number(raw.sticky) > 0 : false,
    time: time ? new Date(time).getTime() : Date.now(),
    pid: raw.pid,
    rid: raw.rid,
    // 下面四个由 comment-identity 计算：头像与 UA 是纯函数，属地需要查库/查接口
    addr,
    browser: identity.browser,
    os: identity.os,
    avatar: identity.avatar,
  }
}

/** 内部用：规范化时多带一个 ip，仅用于查属地，绝不进公开响应。 */
interface NormalizedWithIp extends ReturnType<typeof normalizeComment> {
  ip: string
}

function normalizeWithIp(raw: RawComment): NormalizedWithIp {
  return { ...normalizeComment(raw), ip: raw.ip ?? '' }
}

type NormalizedComment = ReturnType<typeof normalizeComment>
type CommentNode = NormalizedComment & { children?: NormalizedComment[] }
type CommentNodeWithIp = NormalizedWithIp & { children?: NormalizedWithIp[] }

/**
 * 把评论树摊平成一维数组（根 + 所有子回复）。
 * 属地是在 DB 连接关闭之后才查的，需要能遍历整棵树回填 addr。
 */
function flattenTree<T extends { children?: T[] }>(nodes: T[]): T[] {
  const out: T[] = []
  for (const node of nodes) {
    out.push(node)
    if (node.children?.length) out.push(...flattenTree(node.children))
  }
  return out
}

/**
 * 回填 IP 属地。
 * 刻意放在 withDb 之外：属地查询要走 HTTP，占着数据库连接等外网是最常见的拖垮连接池的写法。
 */
async function attachAddr(tree: CommentNodeWithIp[]): Promise<void> {
  const flat = flattenTree(tree)
  if (!flat.length) return
  const addrMap = await lookupAddrs(flat.map((node) => node.ip))
  for (const node of flat) {
    node.addr = addrMap.get(String(node.ip ?? '').trim()) ?? ''
  }
}

/** 剥掉内部字段，得到能安全返回给访客的形状。 */
function toPublic(node: CommentNodeWithIp): CommentNode {
  const { ip: _ip, children, ...rest } = node
  const out: CommentNode = rest
  if (children?.length) out.children = children.map(toPublic)
  return out
}

// ==================== XSS 清洗 ====================

/**
 * 评论内容 XSS 清洗。
 * 优先用 sanitize-html（若已安装），否则用兜底的白名单正则（只保留少量标签）。
 * 兜底方案不是真正的 HTML 解析器，对畸形标签可能漏过，但配合前端 markdown-it
 * 的默认安全策略 + 后台展示用 orig 原文，风险可控。
 */
function sanitizeComment(html: string): string {
  if (sanitizeHtml) {
    return sanitizeHtml(html, {
      allowedTags: [
        'a', 'b', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4',
        'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'span',
        'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead',
        'tr', 'ul',
      ],
      allowedAttributes: {
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'alt', 'title'],
        span: ['style'],
      },
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      allowedSchemesByTag: { img: ['http', 'https'] },
      transformTags: {
        a: (tagName: string, attribs: Record<string, string>) => ({
          tagName,
          attribs: {
            ...attribs,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
          },
        }),
      },
    })
  }
  // 兜底：去掉所有 script/style/iframe/object 标签及事件属性
  return html
    .replace(/<(script|style|iframe|object|embed|form|input)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

// ==================== 评论：查询 ====================

/**
 * 查询某篇文章的评论列表（兼容 @waline/client）。
 * GET /api/comment?path=&page=&pageSize=&sortBy=&type=list
 */
export async function listComments(options: {
  path: string
  page: number
  pageSize: number
  sortBy: 'newest' | 'oldest' | 'hottest'
}): Promise<{ count: number; data: ReturnType<typeof normalizeComment>[]; totalPages: number }> {
  const { path, page, pageSize, sortBy } = options
  const url = normalizeUrl(path)

  const tree = await withDb(async (client) => {
    // 只返回 approved 状态的评论给前端
    const countResult = await client.query(
      `SELECT COUNT(*) FROM ${table('comment')} WHERE url = $1 AND status = 'approved'`,
      [url],
    )
    const count = Number(countResult.rows[0].count)
    const totalPages = Math.max(1, Math.ceil(count / pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const offset = (safePage - 1) * pageSize

    let orderBy = 'createdat DESC'
    if (sortBy === 'oldest') orderBy = 'createdat ASC'
    else if (sortBy === 'hottest') orderBy = '"like" DESC NULLS LAST, createdat DESC'

    const result = await client.query(
      `SELECT * FROM ${table('comment')}
       WHERE url = $1 AND status = 'approved'
       ORDER BY (sticky IS NOT NULL AND sticky > 0) DESC, ${orderBy}
       LIMIT $2 OFFSET $3`,
      [url, pageSize, offset],
    )

    const rows = result.rows as RawComment[]
    // 组装父子树：rid（根评论 id）相同的归到同一线程
    const roots = rows.filter((r) => r.rid == null && r.pid == null)
    const children = rows.filter((r) => r.rid != null || r.pid != null)

    const nodes = roots.map((root) => {
      const node: CommentNodeWithIp = normalizeWithIp(root)
      const replies = children
        .filter((c) => c.rid === root.id || c.pid === root.id)
        .sort((a, b) => {
          const ta = new Date(a.insertedat ?? a.createdat ?? 0).getTime()
          const tb = new Date(b.insertedat ?? b.createdat ?? 0).getTime()
          return ta - tb
        })
        .map((c) => normalizeWithIp(c))
      if (replies.length) node.children = replies
      return node
    })

    return { nodes, count, totalPages }
  })

  // 属地查询放在数据库连接归还之后，避免握着连接等外网接口
  await attachAddr(tree.nodes)

  return {
    count: tree.count,
    data: tree.nodes.map(toPublic),
    totalPages: tree.totalPages,
  }
}

/** 获取最近评论（全站，用于侧边栏） */
export async function recentComments(count: number): Promise<ReturnType<typeof normalizeComment>[]> {
  const nodes = await withDb(async (client) => {
    const result = await client.query(
      `SELECT * FROM ${table('comment')}
       WHERE status = 'approved'
       ORDER BY createdat DESC
       LIMIT $1`,
      [count],
    )
    return (result.rows as RawComment[]).map(normalizeWithIp)
  })
  await attachAddr(nodes)
  return nodes.map(toPublic)
}

/** 获取某几篇文章的评论数 */
export async function commentCount(urls: string[]): Promise<Record<string, number>> {
  if (!urls.length) return {}
  return withDb(async (client) => {
    const result = await client.query(
      `SELECT url, COUNT(*) as cnt FROM ${table('comment')}
       WHERE url = ANY($1) AND status = 'approved'
       GROUP BY url`,
      [urls],
    )
    const map: Record<string, number> = {}
    for (const row of result.rows) {
      map[row.url] = Number(row.cnt)
    }
    return map
  })
}

// ==================== 评论：发表 ====================

export interface CreateCommentInput {
  comment: string
  nick: string
  mail: string
  link: string
  url: string
  ua: string
  pid?: number
  rid?: number
  at?: string
}

/**
 * 发表评论。
 * - 访客评论默认进入 waiting（审核），除非 COMMENT_AUDIT=false。
 * - 管理员（user_id 存在且是 administrator）发的评论直接 approved。
 */
export async function createComment(
  input: CreateCommentInput,
  context: { ip: string; isAdmin: boolean; adminUserId?: number },
): Promise<ReturnType<typeof normalizeComment>> {
  const { comment, nick, mail, link, url, ua, pid, rid } = input
  const orig = comment
  const sanitized = sanitizeComment(comment)

  if (!sanitized.trim()) throw new WalineServerError('评论内容不能为空', 400)
  if (!url.trim()) throw new WalineServerError('缺少评论所属页面地址', 400)

  // 昵称与邮箱必填：前端的 requiredMeta 只是体验层，直接打接口能绕过去，
  // 而头像要按邮箱算，没有邮箱的评论在列表里就是一张默认图。
  const finalNick = (nick ?? '').trim()
  const finalMail = (mail ?? '').trim()
  if (!finalNick) throw new WalineServerError('昵称不能为空', 400)
  if (!finalMail) throw new WalineServerError('邮箱不能为空', 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalMail)) {
    throw new WalineServerError('邮箱格式不正确', 400)
  }

  // 字数限制
  const maxLen = Number(process.env.COMMENT_MAX_LENGTH ?? 2000) || 2000
  if (orig.length > maxLen) throw new WalineServerError(`评论内容过长（最多 ${maxLen} 字）`, 400)

  // 反垃圾
  if (!context.isAdmin) {
    if (rateLimitIp(context.ip)) throw new WalineServerError('评论过于频繁，请稍后再试', 429)
    const fw = hitForbiddenWords(orig)
    if (fw) throw new WalineServerError('评论包含违禁词', 400)
    // Akismet 可选
    const akismetResult = await akismetCheck({
      comment: orig,
      nick: finalNick,
      mail: finalMail,
      ip: context.ip,
      ua,
    })
    if (akismetResult === 'spam') {
      // 命中 Akismet：存为 spam 而不是直接拒绝，方便后台误判恢复
      const status = 'spam'
      return insertComment({
        comment: sanitized,
        orig,
        nick: finalNick,
        mail: finalMail,
        link: link?.trim() || '',
        url: normalizeUrl(url),
        ua,
        ip: context.ip,
        pid: pid ?? null,
        rid: rid ?? null,
        status,
        user_id: null,
      })
    }
  }

  const auditEnabled = process.env.COMMENT_AUDIT !== 'false'
  const status = context.isAdmin ? 'approved' : auditEnabled ? 'waiting' : 'approved'

  return insertComment({
    comment: sanitized,
    orig,
    nick: finalNick,
    mail: finalMail,
    link: link?.trim() || '',
    url: normalizeUrl(url),
    ua,
    ip: context.ip,
    pid: pid ?? null,
    rid: rid ?? null,
    status,
    user_id: context.isAdmin ? context.adminUserId ?? null : null,
  })
}

async function insertComment(params: {
  comment: string
  orig: string
  nick: string
  mail: string
  link: string
  url: string
  ua: string
  ip: string
  pid: number | null
  rid: number | null
  status: string
  user_id: number | null
}): Promise<ReturnType<typeof normalizeComment>> {
  const raw = await withDb(async (client) => {
    // 如果有 pid，查询父评论取 rid（根评论 id）
    let finalRid = params.rid
    if (params.pid != null && finalRid == null) {
      const parent = await client.query(
        `SELECT id, rid FROM ${table('comment')} WHERE id = $1`,
        [params.pid],
      )
      if (parent.rowCount) {
        finalRid = parent.rows[0].rid ?? parent.rows[0].id
      }
    }

    const result = await client.query(
      `INSERT INTO ${table('comment')}
       (user_id, comment, ip, link, mail, nick, pid, rid, status, ua, url, "like", insertedat, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, now(), now(), now())
       RETURNING *`,
      [
        params.user_id,
        params.comment,
        params.ip,
        params.link || null,
        params.mail || null,
        params.nick,
        params.pid,
        finalRid,
        params.status,
        params.ua,
        params.url,
      ],
    )
    return result.rows[0] as RawComment
  })

  // 刚发出的评论也要带属地，否则作者自己看到的卡片比别人少一个徽章
  const addr = await lookupAddr(params.ip)
  const out = normalizeComment(raw, addr)
  // 把 orig 也带回去，前端编辑时要用
  ;(out as ReturnType<typeof normalizeComment> & { orig?: string }).orig = params.orig
  return out
}

// ==================== 评论：点赞 ====================

/**
 * 点赞 / 取消点赞。
 * 用 cookie 防重复：前端会带一个 token，同 token 不重复加。
 * 简化版：直接 +1，前端用 localStorage 记录已点赞的评论 id。
 */
export async function likeComment(id: number, unlike: boolean): Promise<number> {
  return withDb(async (client) => {
    const delta = unlike ? -1 : 1
    const result = await client.query(
      `UPDATE ${table('comment')} SET "like" = COALESCE("like", 0) + $1, updatedat = now()
       WHERE id = $2 RETURNING "like"`,
      [delta, id],
    )
    if (!result.rowCount) throw new WalineServerError('评论不存在', 404)
    return Number(result.rows[0].like ?? 0)
  })
}

// ==================== 评论：更新 / 删除（管理员） ====================

export async function updateComment(id: number, patch: Record<string, unknown>): Promise<RawComment> {
  return withDb(async (client) => {
    const allowed = ['comment', 'nick', 'mail', 'link', 'status', 'sticky']
    const sets: string[] = []
    const values: unknown[] = []
    let idx = 1
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        sets.push(`${key} = $${idx++}`)
        values.push(patch[key])
      }
    }
    if (patch.comment !== undefined) {
      // 更新内容时重新清洗
      const sanitized = sanitizeComment(String(patch.comment))
      const ci = sets.indexOf('comment = $1')
      // 找到 comment 那个 $N 替换为 sanitized
      const commentIdx = allowed.indexOf('comment')
      if (commentIdx >= 0) {
        values[commentIdx] = sanitized
      }
    }
    if (!sets.length) throw new WalineServerError('没有可更新的字段', 400)
    sets.push('updatedat = now()')
    values.push(id)
    const result = await client.query(
      `UPDATE ${table('comment')} SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    )
    if (!result.rowCount) throw new WalineServerError('评论不存在', 404)
    return result.rows[0] as RawComment
  })
}

export async function deleteComment(id: number): Promise<void> {
  await withDb(async (client) => {
    // 先删子回复，再删自己
    await client.query(`DELETE FROM ${table('comment')} WHERE pid = $1 OR rid = $1`, [id])
    await client.query(`DELETE FROM ${table('comment')} WHERE id = $1`, [id])
  })
}

// ==================== 计数（阅读量 / 反应） ====================

export async function getCounter(url: string): Promise<RawCounter> {
  const normUrl = normalizeUrl(url)
  return withDb(async (client) => {
    const result = await client.query(
      `SELECT * FROM ${table('counter')} WHERE url = $1`,
      [normUrl],
    )
    if (result.rowCount) return result.rows[0] as RawCounter
    // 不存在则创建
    const inserted = await client.query(
      `INSERT INTO ${table('counter')} (url, time, reaction0, reaction1, reaction2, reaction3, reaction4, reaction5, reaction6, reaction7, reaction8)
       VALUES ($1, 0, 0,0,0,0,0,0,0,0,0) RETURNING *`,
      [normUrl],
    )
    return inserted.rows[0] as RawCounter
  })
}

/**
 * 更新计数。
 * type: 'time'（阅读量）/ 'reaction0'~'reaction8'
 * action: 'inc' / 'dec' / 'set'
 */
export async function updateCounter(url: string, type: string, action: string, value?: number): Promise<RawCounter> {
  const normUrl = normalizeUrl(url)
  const validType = type === 'time' || /^reaction[0-8]$/.test(type)
  if (!validType) throw new WalineServerError('未知的计数类型', 400)

  return withDb(async (client) => {
    // 先确保行存在（wl_counter.url 无唯一约束，不能用 ON CONFLICT）
    const existing = await client.query(
      `SELECT id FROM ${table('counter')} WHERE url = $1 LIMIT 1`,
      [normUrl],
    )
    if (!existing.rowCount) {
      await client.query(
        `INSERT INTO ${table('counter')} (url, time, reaction0, reaction1, reaction2, reaction3, reaction4, reaction5, reaction6, reaction7, reaction8)
         VALUES ($1, 0, 0,0,0,0,0,0,0,0,0)`,
        [normUrl],
      )
    }
    const delta = action === 'inc' ? 1 : action === 'dec' ? -1 : value ?? 0
    const result = await client.query(
      `UPDATE ${table('counter')} SET ${type} = GREATEST(0, COALESCE(${type}, 0) + $1), updatedat = now()
       WHERE url = $2 RETURNING *`,
      [delta, normUrl],
    )
    return result.rows[0] as RawCounter
  })
}

// ==================== 用户 ====================

export async function ensureAdminAccount(email: string, displayName: string): Promise<number> {
  return withDb(async (client) => {
    const found = await client.query(
      `SELECT id FROM ${table('users')} WHERE type = 'administrator' ORDER BY id LIMIT 1`,
    )
    if (found.rowCount) return Number(found.rows[0].id)
    const inserted = await client.query(
      `INSERT INTO ${table('users')} (display_name, email, type, createdat, updatedat)
       VALUES ($1, $2, 'administrator', now(), now()) RETURNING id`,
      [displayName, email],
    )
    return Number(inserted.rows[0].id)
  })
}

// ==================== 工具 ====================

/**
 * 规范化 url：Waline 存的可能是完整地址也可能是裸路径。
 * 这里统一成 pathname，避免同一篇文章因为带不带域名而拆成两条计数。
 */
function normalizeUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url, 'http://local')
    // 保留 query string（Walines 的 url 可能带 ? 参数用于区分分页）
    return u.pathname + u.search
  } catch {
    return url
  }
}
