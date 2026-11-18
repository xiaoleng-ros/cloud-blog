/**
 * 前台 AI 调用 API（同源，供博客前台功能如 AI 摘要 / 写作助手使用）。
 *
 * 安全设计：
 * - 同源校验（浏览器跨域调用被拒；前台与 CMS 同域部署）
 * - 按 IP 限流（10 次/分钟），防止被当作免费代理刷量
 * - 只能调用后台标记为「允许前台调用」的模型（allowFrontend）
 * - API Key 只在服务端使用，绝不出现在响应里
 * - 严格校验 messages 结构，拒绝超长内容
 */

import { NextResponse } from 'next/server'

import { clientIp } from '../../../../lib/client-ip'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  callModel,
  checkFrontendRateLimit,
  findModel,
  readProviders,
  type ChatMessage,
} from '../../../../lib/ai-service'

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
const err = (message: string, status = 400) => json({ error: message }, status)

const MAX_MESSAGES = 20
const MAX_CONTENT_LEN = 8000

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err('跨站请求被拒绝', 403)

  const ip = clientIp(request)
  // 拿不到可信 IP 时不放行（避免所有匿名请求共用一个桶导致滥用）
  if (!ip || !checkFrontendRateLimit(ip)) return err('调用过于频繁，请稍后再试', 429)

  let body: { modelId?: unknown; messages?: unknown; temperature?: unknown; maxTokens?: unknown }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }

  const modelId = String(body.modelId ?? '').trim()
  if (!modelId) return err('缺少 modelId')

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return err('messages 必须是 1-' + MAX_MESSAGES + ' 条的数组')
  }
  const messages: ChatMessage[] = []
  for (const m of body.messages as Array<Record<string, unknown>>) {
    const role = String(m.role ?? '')
    const content = String(m.content ?? '')
    if (!['system', 'user', 'assistant'].includes(role)) return err('非法的 message role')
    if (!content || content.length > MAX_CONTENT_LEN) return err('消息内容为空或超过 ' + MAX_CONTENT_LEN + ' 字')
    messages.push({ role: role as ChatMessage['role'], content })
  }

  const providers = await readProviders()
  const found = findModel(providers, modelId, { frontendOnly: true })
  if (!found) return err('模型不存在或未开放前台调用', 404)

  const temperature = typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.7
  const maxTokens = typeof body.maxTokens === 'number' ? Math.max(1, Math.min(4096, body.maxTokens)) : undefined

  try {
    const result = await callModel({
      provider: found.provider,
      modelId,
      messages,
      temperature,
      maxTokens,
      signal: request.signal,
    })
    // 只返回必要字段，不泄露供应商信息 / Key
    return json({ content: result.content, model: result.model, usage: result.usage })
  } catch (e) {
    const msg = (e as Error).message
    // 调用方中止不记 5xx
    if ((e as Error).name === 'AbortError') return err('请求已取消', 499)
    return err('模型调用失败：' + msg, 502)
  }
}

/** GET：列出前台可用的模型（供前台功能渲染选择器；不含任何 Key） */
export async function GET() {
  const providers = await readProviders()
  const models: Array<{ modelId: string; displayName: string; providerName: string; free: boolean }> = []
  for (const p of providers) {
    if (p.enabled === false) continue
    for (const m of p.models ?? []) {
      if (!m.allowFrontend) continue
      models.push({
        modelId: m.modelId,
        displayName: m.displayName || m.modelId,
        providerName: p.name,
        free: Boolean(m.free),
      })
    }
  }
  return json({ models })
}
