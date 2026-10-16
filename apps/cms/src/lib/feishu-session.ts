import { jwtVerify } from 'jose'
import type { Payload } from 'payload'

/**
 * 服务端会话校验工具（供飞书登录链路使用）
 *
 * 背景：Route Handler 里拿不到 Payload 的 req.user，只能自己从 cookie 解析令牌。
 * 这里只做「校验」，不做签发 —— 签发见 /api/feishu/callback 的 createUserSession。
 */

/** 与 /api/feishu/redirect 保持同名 */
export const FEISHU_STATE_COOKIE = 'feishu-oauth-state'

export type VerifiedUser = {
  id: string | number
  email?: string
  /** 会话 id，用于吊销（改密码/后台删会话后该令牌立即失效） */
  sid?: string
}

/** 从请求头解析单个 cookie */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    const raw = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

/**
 * 校验当前请求是否携带有效的管理员会话。
 * 校验内容与 Payload 的 jwt strategy 对齐：签名 + exp + collection + sid 必须仍在 sessions 里。
 *
 * 性能：每次校验都要 findByID 查 user（确认 sid 仍在 sessions 里、可被吊销）。
 * 本地直连 Supabase 时这是一次跨公网往返；后台每个受保护接口都过一遍会很卡。
 * 这里按 `${id}:${sid}` 做 5s 短缓存：重复请求零查库；5s 内会话被吊销（改密 / 后台删会话）
 * 仍能生效。TTL 取得与 sync-cache 快照一致，吊销延迟可接受。
 * @returns 已登录用户；未登录 / 会话已吊销时返回 null
 */
const USER_CACHE_TTL_MS = 5_000
interface UserCacheEntry {
  result: VerifiedUser | null
  ts: number
}
const userCache = new Map<string, UserCacheEntry>()

export async function verifyRequestUser(
  request: Request,
  payload: Payload,
): Promise<VerifiedUser | null> {
  const cookiePrefix = (payload.config as { cookiePrefix?: string }).cookiePrefix ?? 'payload'
  const token = readCookie(request, `${cookiePrefix}-token`)
  if (!token) return null

  let decoded: { id?: string | number; collection?: string; email?: string; sid?: string }
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(payload.secret))
    decoded = result.payload as typeof decoded
  } catch {
    return null
  }

  if (!decoded.id || decoded.collection !== 'users') return null

  const cacheKey = `${decoded.id}:${decoded.sid ?? ''}`
  const cached = userCache.get(cacheKey)
  const now = Date.now()
  if (cached && now - cached.ts <= USER_CACHE_TTL_MS) {
    return cached.result
  }

  const user = await payload.findByID({ collection: 'users', id: decoded.id, depth: 0 }).catch(() => null)
  if (!user) {
    // 负缓存也写：避免被删用户每个请求都查一次库
    userCache.set(cacheKey, { result: null, ts: now })
    return null
  }

  // useSessions 开启时，令牌必须携带仍然存在的 sid（等同「可吊销」）
  const useSessions = (payload.collections.users?.config.auth as { useSessions?: boolean } | undefined)
    ?.useSessions
  if (useSessions) {
    const sessions = ((user as unknown as { sessions?: Array<{ id: string; expiresAt: string | Date }> })
      .sessions ?? []).filter((s) => new Date(s.expiresAt) > new Date())
    if (!decoded.sid || !sessions.some((s) => s.id === decoded.sid)) {
      userCache.set(cacheKey, { result: null, ts: now })
      return null
    }
  }

  const result = { id: decoded.id, email: (user as { email?: string }).email, sid: decoded.sid }
  userCache.set(cacheKey, { result, ts: now })
  return result
}
