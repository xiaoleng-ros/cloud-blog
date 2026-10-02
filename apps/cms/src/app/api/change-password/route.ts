import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { APIError, getPayload } from 'payload'
import config from '@payload-config'
import { verifyRequestUser } from '../../../lib/feishu-session'
import { validatePasswordStrength } from '../../../lib/password'

/**
 * 修改密码（需验旧密码）
 *
 * 为什么需要自定义路由：
 *   账号页改密原本走 Payload 内置 REST「PATCH /api/users/{id}」，只提交新密码即可覆盖，
 *   不校验旧密码。Payload 3.88 的 auth 没有 requireCurrentPassword 这类内置开关
 *   （Users.ts 里已注明「忘记密码时飞书扫码进来改密码」正依赖不要求旧密码），
 *   也没有能在改密时读到旧密码明文的可插入钩子点。于是这里补一条最小可靠的服务端路由：
 *   先按 Payload 本地策略算法校验旧密码，通过后再落库更新，从而堵住「会话被窃即可永久接管」。
 *   密码强度规则维持产品决策（6-18 位、至少两类组合，见 lib/password），此处不额外加严。
 *
 * 契约（与前端 errorMessage() 读取 json.errors[0].message 保持一致）：
 *   POST /api/change-password  body: { currentPassword, newPassword }
 *   200 { ok: true } | 400 { errors:[{message}] } | 401 未登录 | 403 跨站
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getDb() {
  return getPayload({ config })
}

/** 统一的错误响应（errors 数组形态，兼容 Payload REST 客户端） */
const errorJson = (message: string, status: number) =>
  NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * 按 Payload 本地策略算法校验密码：crypto.pbkdf2(password, salt, 25000, 512, 'sha256')
 * 与存储 hash 做恒定时间比较。参数与 payload/dist/auth/strategies/local/authenticate.js 对齐。
 */
function verifyLocalPassword(password: string, salt: string, hash: string): Promise<boolean> {
  return new Promise((resolve) => {
    crypto.pbkdf2(password, salt, 25000, 512, 'sha256', (err, derived) => {
      if (err) return resolve(false)
      try {
        const stored = Buffer.from(hash, 'hex')
        resolve(derived.length === stored.length && crypto.timingSafeEqual(derived, stored))
      } catch {
        resolve(false)
      }
    })
  })
}

export async function POST(request: Request) {
  // 带 cookie 的写操作：先做同源校验，防止 CSRF
  const originHeader = request.headers.get('origin')
  if (originHeader) {
    let origin: URL
    try {
      origin = new URL(originHeader)
    } catch {
      return errorJson('跨站请求被拒绝', 403)
    }
    if (origin.origin !== new URL(request.url).origin) {
      return errorJson('跨站请求被拒绝', 403)
    }
  }

  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) return errorJson('未登录或会话已失效', 401)

  let body: { currentPassword?: unknown; newPassword?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return errorJson('请求体必须是 JSON', 400)
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  const strengthError = validatePasswordStrength(newPassword)
  if (strengthError) return errorJson(strengthError, 400)

  // 读取原始记录的 salt / hash 列（db 层绕过字段级 read access，等同于登录校验取的字段）
  const doc = (await payload.db.findOne({
    collection: 'users',
    where: { id: { equals: user.id } },
  })) as unknown as { salt?: string | null; hash?: string | null } | null

  if (!doc) {
    return errorJson('账号状态异常，无法修改密码', 400)
  }

  // 从未设置过密码的账号（例如仅飞书扫码注册）：允许直接设置新密码，保住「忘记密码 → 飞书扫码进来改密码」的找回路径。
  // 已设过密码的账号必须验旧密。
  if (typeof doc.salt === 'string' && doc.salt && typeof doc.hash === 'string' && doc.hash) {
    if (!currentPassword) return errorJson('请输入旧密码', 400)
    const ok = await verifyLocalPassword(currentPassword, doc.salt, doc.hash)
    if (!ok) {
      // 用 APIError 承载「旧密码不正确」语义，再序列化为前端可读的 errors[].message
      const err = new APIError('旧密码不正确', 400)
      return errorJson(err.message, err.status ?? 400)
    }
  }

  // 校验通过：更新密码（会触发 Users 的 beforeValidate 强度校验并重新加盐哈希）。
  // 归属已由 verifyRequestUser 确认为当前登录用户本人，故 overrideAccess 更新自己安全。
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { password: newPassword } as never,
    overrideAccess: true,
    depth: 0,
  })

  // 改密即吊销其它会话（兑现 Users.ts auth 注释里「改密码能立即吊销已签发令牌」的承诺；
  // 飞书找回免旧密分支同样走到这里）。Payload 3.88 的会话不是独立集合，而是用户文档的
  // sessions 数组（表 users_sessions，元素 { id, createdAt, expiresAt }），
  // 以下写法对齐 payload/dist/auth/operations/logout.js：db 层直接改写、跳过钩子、不重哈希密码。
  // 保留调用方自己的 sid，避免刚改完密码就被自己踢下线（体验断裂）。
  try {
    const fresh = (await payload.db.findOne({
      collection: 'users',
      where: { id: { equals: user.id } },
    })) as unknown as { sessions?: Array<{ id: string }>; updatedAt?: string | null } | null
    if (fresh) {
      fresh.sessions = (fresh.sessions ?? []).filter((s) => s.id === user.sid)
      // 只动会话不 bump updatedAt（同 logout.js），避免前台同步把它误判为内容变更
      fresh.updatedAt = null
      await payload.db.updateOne({
        id: user.id,
        collection: 'users',
        data: fresh as never,
        returning: false,
      })
    }
  } catch (err) {
    // 吊销失败不影响改密结果，但必须留痕：其它会话仍存活
    console.error('[change-password] 吊销其它会话失败:', err)
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
