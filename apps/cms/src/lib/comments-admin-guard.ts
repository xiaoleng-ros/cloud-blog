import { NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { verifyRequestUser } from './feishu-session'
import { WalineAdminError } from './waline-admin'

/**
 * 评论管理路由的共用闸门：登录态 + 同源 + 错误序列化。
 *
 * 鉴权门槛与站点设置（SiteSettings global）一致——「已登录的后台用户」，不再额外查角色：
 * 评论审核是低风险读操作，而角色判断埋在 Users 集合的 access 里（模块私有函数），
 * 为这一个页面把它抽成公共 API 反而扩大改动面。
 */

export const json = (data: unknown) =>
  NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })

export const errorJson = (message: string, status: number) =>
  NextResponse.json({ errors: [{ message }] }, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * 带 cookie 的写操作必须同源，防 CSRF（与 change-password 同口径，不做任何端口放宽）。
 *
 * 后果要说清：博客联调经 4321 代理时，proxy.mjs 把 Host 重写成 9527，Origin 仍是 4321，
 * 这里的全等比较必然判为跨站 → 后台写操作请在 9527 直连做，4321 只用来验前台。
 */
const sameOrigin = (request: Request) => {
  const originHeader = request.headers.get('origin')
  if (!originHeader) return true
  try {
    return new URL(originHeader).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

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
  // 顺带把 payload 交出去：列表要把评论挂靠的文章路径换成标题，别再实例化一次
  return { ok: true, userId: user.id, payload }
}

/** 把 Waline 侧的失败转成前端可读的 errors[].message */
export const toErrorResponse = (error: unknown) => {
  // 面向用户的文案由前端 describeApiError 统一收敛成通用提示，真实原因只留服务端日志
  if (error instanceof WalineAdminError) {
    if (error.status >= 500) console.error('[comments]', error.message)
    return errorJson(error.message, error.status)
  }
  console.error('[comments] 评论服务调用失败:', error)
  return errorJson('评论服务暂时不可用，请稍后重试', 502)
}
