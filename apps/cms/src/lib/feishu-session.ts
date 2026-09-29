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
 * @returns 已登录用户；未登录 / 会话已吊销时返回 null
 */
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

  const user = await payload.findByID({ collection: 'users', id: decoded.id, depth: 0 }).catch(() => null)
  if (!user) return null

  // useSessions 开启时，令牌必须携带仍然存在的 sid（等同「可吊销」）
  const useSessions = (payload.collections.users?.config.auth as { useSessions?: boolean } | undefined)
    ?.useSessions
  if (useSessions) {
    const sessions = ((user as unknown as { sessions?: Array<{ id: string; expiresAt: string | Date }> })
      .sessions ?? []).filter((s) => new Date(s.expiresAt) > new Date())
    if (!decoded.sid || !sessions.some((s) => s.id === decoded.sid)) return null
  }

  return { id: decoded.id, email: (user as { email?: string }).email, sid: decoded.sid }
}
