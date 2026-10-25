import {
  createComment,
  deleteComment,
  getCounter,
  likeComment,
  listComments,
  commentCount,
  recentComments,
  updateComment,
  updateCounter,
  WalineServerError,
  ensureAdminAccount,
  normalizeComment,
  withDb,
  table,
} from '../../../../lib/waline-server'
import { scheduleLazyGc } from '../../../../lib/comment-image-gc'
import { lookupAddr as prefetchAddr } from '../../../../lib/comment-identity'

// 评论服务用 pg 直连，只能在 Node 运行时跑
export const runtime = 'nodejs'
// 每次都要实时读写，禁止静态化/缓存
export const dynamic = 'force-dynamic'

const ADMIN_EMAIL = 'cms-moderation@invalid.local'

/** 取客户端真实 IP：只信 XFF 首段，防止伪造 */
function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? ''
  return request.headers.get('x-real-ip') ?? ''
}

/**
 * 鉴权：检查请求是否带有效的管理员令牌。
 * 简化版：服务端在进程内用 JWT_TOKEN 自签令牌（与 waline-admin 一致）。
 * 这里只校验 token 能否用 JWT_TOKEN 解开，不查 wl_users（管理后台自己保证）。
 */
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)

function verifyAdminToken(request: Request): { ok: boolean; userId?: number } {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return { ok: false }
  const token = auth.slice(7)
  const key = process.env.JWT_TOKEN
  if (!key) return { ok: false }
  try {
    const jwt = require_('jsonwebtoken')
    const decoded = jwt.verify(token, key)
    // payload 直接是 user id（与 waline-admin 的 mintAdminToken 一致）
    const userId = typeof decoded === 'string' ? Number(decoded) : Number(decoded?.sub ?? decoded)
    if (!Number.isFinite(userId)) return { ok: false }
    return { ok: true, userId }
  } catch {
    return { ok: false }
  }
}

/** 统一信封：成功 errno=0，失败 errno=status */
function ok<T>(data: T, extra: Record<string, unknown> = {}): Response {
  return Response.json({ errno: 0, data, ...extra }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

function fail(err: unknown): Response {
  if (err instanceof WalineServerError) {
    return Response.json({ errno: err.status, errmsg: err.message }, { status: err.status })
  }
  console.error('[waline] 未捕获错误', err)
  return Response.json({ errno: 500, errmsg: '评论服务内部错误' }, { status: 500 })
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // 剥掉 /api/waline 前缀，得到 Waline 原生路径
  const stripped = url.pathname.replace(/^\/api\/waline/, '') || '/'
  const method = request.method.toUpperCase()
  const params = url.searchParams

  try {
    // ==================== 评论 ====================
    if (stripped === '/api/comment' && method === 'GET') {
      const type = params.get('type')
      // 评论数统计
      if (type === 'count') {
        const urls = (params.get('url') ?? '').split(',').filter(Boolean)
        const counts = await commentCount(urls)
        return ok(counts)
      }
      // 最近评论
      if (type === 'recent') {
        const count = Number(params.get('count') ?? 10) || 10
        const data = await recentComments(count)
        return ok(data)
      }
      // 默认：文章评论列表
      const path = params.get('path') ?? ''
      const page = Number(params.get('page') ?? 1) || 1
      const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 10) || 10))
      const sortBy = (params.get('sortBy') ?? 'newest') as 'newest' | 'oldest' | 'hottest'
      const result = await listComments({ path, page, pageSize, sortBy })
      return ok(result.data, { count: result.count, totalPages: result.totalPages })
    }

    if (stripped === '/api/comment' && method === 'POST') {
      const body = (await request.json()) as Record<string, unknown>
      const auth = verifyAdminToken(request)
      const created = await createComment(
        {
          comment: String(body.comment ?? ''),
          nick: String(body.nick ?? ''),
          mail: String(body.mail ?? ''),
          link: String(body.link ?? ''),
          url: String(body.url ?? ''),
          ua: String(body.ua ?? request.headers.get('user-agent') ?? ''),
          pid: body.pid ? Number(body.pid) : undefined,
          rid: body.rid ? Number(body.rid) : undefined,
          at: body.at ? String(body.at) : undefined,
        },
        { ip: clientIp(request), isAdmin: auth.ok, adminUserId: auth.userId },
      )
      // 访客评论成功 → 触发惰性图片回收（节流 6 小时）
      if (!auth.ok) scheduleLazyGc()
      return ok(created)
    }

    // PUT /api/comment/:id —— 管理员更新 / 访客点赞
    const updateMatch = stripped.match(/^\/api\/comment\/(\d+)$/)
    if (updateMatch && method === 'PUT') {
      const id = Number(updateMatch[1])
      const auth = verifyAdminToken(request)
      const body = (await request.json()) as Record<string, unknown>
      // 点赞：body 里有 like 字段且非管理员
      if (body.like !== undefined && !auth.ok) {
        const like = Number(body.like)
        const newLike = await likeComment(id, like < 0)
        return ok({ like: newLike })
      }
      // 管理员更新
      if (!auth.ok) {
        return Response.json({ errno: 403, errmsg: '无权操作' }, { status: 403 })
      }
      const updated = await updateComment(id, body)
      // normalizeComment 已不含 mail/ip/ua；管理员在这里只需看到更新后的内容，
      // 邮箱等后台字段走带鉴权的 /api/comments
      return ok({ ...normalizeComment(updated, await prefetchAddr(updated.ip)) })
    }

    // DELETE /api/comment/:id —— 管理员删除
    if (updateMatch && method === 'DELETE') {
      const id = Number(updateMatch[1])
      const auth = verifyAdminToken(request)
      if (!auth.ok) {
        return Response.json({ errno: 403, errmsg: '无权操作' }, { status: 403 })
      }
      await deleteComment(id)
      return ok({ id })
    }

    // ==================== 计数（阅读量 / 反应） ====================
    if (stripped === '/api/article' && method === 'GET') {
      const paths = (params.get('path') ?? '').split(',').filter(Boolean)
      const types = (params.get('type') ?? 'time').split(',').filter(Boolean)
      const result: Record<string, Record<string, number>> = {}
      for (const p of paths) {
        const counter = await getCounter(p)
        const obj: Record<string, number> = {}
        for (const t of types) {
          if (t === 'time') obj.time = counter.time ?? 0
          else if (/^reaction[0-8]$/.test(t)) obj[t] = (counter as unknown as Record<string, number | null>)[t] ?? 0
        }
        result[p] = obj
      }
      return ok(result)
    }

    if (stripped === '/api/article' && method === 'POST') {
      const body = (await request.json()) as { path: string; type: string; action: string }
      const counter = await updateCounter(body.path, body.type, body.action)
      const obj: Record<string, number> = {}
      if (body.type === 'time') obj.time = counter.time ?? 0
      else if (/^reaction[0-8]$/.test(body.type)) {
        obj[body.type] = (counter as unknown as Record<string, number | null>)[body.type] ?? 0
      }
      return ok({ [body.path]: obj })
    }

    // ==================== 健康检查 ====================
    if (stripped === '/' || stripped === '') {
      return Response.json({ errno: 0, data: { name: 'cloud-blog-waline', version: '2.0' } })
    }

    // 兜底：未匹配的路径返回 404
    return Response.json({ errno: 404, errmsg: 'Not Found' }, { status: 404 })
  } catch (err) {
    return fail(err)
  }
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
export const HEAD = handle
