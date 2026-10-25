import { NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { verifyRequestUser } from './feishu-session'
import { isSameOriginRequest } from './same-origin'
import { WalineAdminError } from './waline-admin'

/**
 * 评论管理路由的共用闸门：登录态 + 同源 + 错误序列化。
 *
 * 鉴权门槛分两档：
 *   - **读**（GET 列表/详情）：任何已登录后台用户即可。评论审核是低风险读操作，
 *     而角色判定埋在 Users 集合的 access 里（模块私有函数）。
 *   - **写**（审核 / 删除 / 回复）：要求管理员 —— 即邮箱命中 `CMS_ADMIN_EMAILS`。
 *     这条以前缺失：任何能登录后台的账号（含将来多加的协作者、被社工骗到密码的路径）
 *     都能删评论、改状态、以站长名义回复。判定口径与 Users.ts 的 isCmsAdmin 完全一致
 *     （同一份环境变量、同样 trim+lowercase），不额外引入角色表。
 */
const CMS_ADMINS = (process.env.CMS_ADMIN_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export const isCmsAdminUser = (user?: { email?: string | null } | null) =>
  !!user?.email && CMS_ADMINS.includes(user.email.toLowerCase())

export const json = (data: unknown) =>
  NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })

export const errorJson = (message: string, status: number) =>
  NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })

// 带 cookie 的写操作必须同源，防 CSRF。判定逻辑统一收口在 lib/same-origin，
// 原本这里「无 Origin 即放行」的分支是 CSRF 缺口（详见该文件头注释）。
const sameOrigin = (request: Request) => isSameOriginRequest(request)

type Guard =
  | { ok: true; userId: string | number; payload: Payload }
  | { ok: false; response: NextResponse }

export async function requireAdmin(request: Request, write = false): Promise<Guard> {
  if (write && !sameOrigin(request)) {
    return { ok: false, response: errorJson('跨站请求被拒绝', 403) }
  }
  const payload = await getPayload({ config })
  const user = await verifyRequestUser(request, payload)
  if (!user) return { ok: false, response: errorJson('未登录或会话已失效', 401) }
  if (write && !(await canModerate(payload, user))) {
    return { ok: false, response: errorJson('只有管理员可以执行该操作', 403) }
  }
  // 顺带把 payload 交出去：列表要把评论挂靠的文章路径换成标题，别再实例化一次
  return { ok: true, userId: user.id, payload }
}

/**
 * 能否执行评论写操作（审核 / 删除 / 回复）。
 *
 * 判定顺序：
 *   1. 邮箱命中 CMS_ADMIN_EMAILS → 可以。
 *   2. 白名单为空 **且库里只有这一个账号** → 可以。
 *      单人博客的部署环境常常只在本地 .env 里填了白名单，云端漏配；
 *      此时如果一律拒绝，站长会突然审不了评论（线上直接瘫痪）。
 *      而「全库只有一个账号」意味着当前登录者必然是站长本人，放行不扩大攻击面。
 *   3. 其余（白名单为空但存在多个账号 / 邮箱不在白名单）→ 拒绝。
 *      一旦开过协作账号，想审核评论就必须显式配白名单，不会因为漏配而静默放开。
 */
async function canModerate(payload: Payload, user: { email?: string | null }): Promise<boolean> {
  if (isCmsAdminUser(user)) return true
  if (CMS_ADMINS.length) return false
  try {
    const { totalDocs } = await payload.count({ collection: 'users', overrideAccess: true })
    if (totalDocs <= 1) return true
    console.error(
      '[comments] CMS_ADMIN_EMAILS 未配置且后台存在多个账号，已拒绝评论写操作；请配置管理员邮箱白名单',
    )
  } catch (err) {
    console.error('[comments] 校验管理员身份失败:', err)
  }
  return false
}

/** 把评论服务侧的失败转成前端可读的 errors[].message */
export const toErrorResponse = (error: unknown) => {
  // 面向用户的文案由前端 describeApiError 统一收敛成通用提示，真实原因只留服务端日志
  if (error instanceof WalineAdminError) {
    if (error.status >= 500) console.error('[comments]', error.message)
    return errorJson(error.message, error.status)
  }
  console.error('[comments] 评论服务调用失败:', error)
  return errorJson('评论服务暂时不可用，请稍后重试', 502)
}
