/**
 * 前台 AI 调用 API（同源，供博客前台功能如 AI 摘要 / 写作助手使用）。
 * - 可指定 platformId / modelId 切换模型；不指定则用前台可用配置的当前模型
 * - 只调用后台标记为「允许前台调用」的配置；按 IP 限流；Key 绝不出响应
 */

import { NextResponse } from 'next/server'

import { getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { clientIp } from '../../../../lib/client-ip'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  callModel,
  checkFrontendRateLimit,
  findFrontendProvider,
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

  let body: { messages?: unknown; temperature?: unknown; maxTokens?: unknown; platformId?: unknown; modelId?: unknown }
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
  const wantedPlatform = body.platformId ? String(body.platformId).trim() : ''
  const provider = wantedPlatform
    ? providers.find((p) => p.platformId === wantedPlatform && p.enabled !== false && p.allowFrontend && (p.modelIds?.length ?? 0) > 0)
    : findFrontendProvider(providers)
  if (!provider) return err('没有可用的前台模型（请到后台开启「允许前台调用」并配置模型）', 404)

  // 切换模型：传入的 modelId 必须在该平台已选模型列表内
  const modelId = body.modelId ? String(body.modelId).trim() : undefined
  if (modelId && !(provider.modelIds ?? []).includes(modelId)) return err('该模型不在此平台已选模型中', 403)

  const temperature = typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.7
  const maxTokens = typeof body.maxTokens === 'number' ? Math.max(1, Math.min(4096, body.maxTokens)) : undefined

  try {
    const result = await callModel({ provider, modelId, messages, temperature, maxTokens, signal: request.signal })
    return json({ content: result.content, model: result.model, usage: result.usage })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return err('请求已取消', 499)
    return err('模型调用失败：' + (e as Error).message, 502)
  }
}

/** GET：列出前台所有可用模型（每个已选模型一项，供前台切换；不含 Key） */
export async function GET() {
  const providers = await readProviders()
  const models: Array<{ platformId: string; platformName: string; modelId: string; modelName: string; current: boolean }> = []
  for (const p of providers) {
    if (p.enabled === false || !p.allowFrontend) continue
    const preset = getPlatformPreset(p.platformId)
    for (const id of p.modelIds ?? []) {
      const name = preset?.models.find((m) => m.id === id)?.name ?? id
      models.push({ platformId: p.platformId, platformName: preset?.name ?? p.platformId, modelId: id, modelName: name, current: id === p.currentModelId })
    }
  }
  return json({ models })
}
