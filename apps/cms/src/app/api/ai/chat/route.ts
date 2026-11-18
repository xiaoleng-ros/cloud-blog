/**
 * 前台 AI 调用 API（同源，供博客前台功能如 AI 摘要 / 写作助手使用）。
 * - 只调用后台标记为「允许前台调用」的配置
 * - 按 IP 限流（10 次/分钟）；API Key 只在服务端使用，绝不出响应
 */

import { NextResponse } from 'next/server'

import { getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { clientIp } from '../../../../lib/client-ip'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  callModel,
  checkFrontendRateLimit,
  findProvider,
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
  if (!ip || !checkFrontendRateLimit(ip)) return err('调用过于频繁，请稍后再试', 429)

  let body: { messages?: unknown; temperature?: unknown; maxTokens?: unknown; platformId?: unknown }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }

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
  // 可指定平台；未指定则用第一个允许前台调用的配置
  const wantedPlatform = body.platformId ? String(body.platformId).trim() : ''
  const provider = wantedPlatform
    ? providers.find((p) => p.platformId === wantedPlatform && p.enabled !== false && p.allowFrontend)
    : findProvider(providers, { frontendOnly: true })
  if (!provider) return err('没有可用的前台模型（请到后台开启「允许前台调用」）', 404)

  const temperature = typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.7
  const maxTokens = typeof body.maxTokens === 'number' ? Math.max(1, Math.min(4096, body.maxTokens)) : undefined

  try {
    const result = await callModel({ provider, messages, temperature, maxTokens, signal: request.signal })
    return json({ content: result.content, model: result.model, usage: result.usage })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return err('请求已取消', 499)
    return err('模型调用失败：' + (e as Error).message, 502)
  }
}

/** GET：列出前台可用模型（供前台功能渲染；不含 Key） */
export async function GET() {
  const providers = await readProviders()
  const models: Array<{ platformId: string; platformName: string; modelId: string; modelName: string }> = []
  for (const p of providers) {
    if (p.enabled === false || !p.allowFrontend) continue
    const preset = getPlatformPreset(p.platformId)
    const modelName = preset?.models.find((m) => m.id === p.modelId)?.name ?? p.modelId
    models.push({
      platformId: p.platformId,
      platformName: preset?.name ?? p.platformId,
      modelId: p.modelId,
      modelName,
    })
  }
  return json({ models })
}
