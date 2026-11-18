/**
 * 后台「AI 模型」管理 API（同源，管理员登录鉴权）。
 * - GET  /api/admin/ai-models          读取已配置平台（Key 脱敏）+ 内置预设列表
 * - PUT  /api/admin/ai-models          保存配置（platformId + Key + modelId + 开关）
 * - POST /api/admin/ai-models          按 platformId 测试调用
 */

import { NextResponse } from 'next/server'

import { AI_PLATFORM_PRESETS, getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { getDb } from '../../../../lib/blog-sync'
import { verifyRequestUser } from '../../../../lib/feishu-session'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  callModel,
  findByPlatform,
  publicProviders,
  readProviders,
  type AiProviderConfig,
  type ChatMessage,
} from '../../../../lib/ai-service'

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
const err = (message: string, status = 400) => json({ error: message }, status)

async function guard(request: Request) {
  if (!isSameOriginRequest(request)) return err('跨站请求被拒绝', 403)
  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) return err('未登录或会话已失效', 401)
  return null
}

export async function GET(request: Request) {
  const denied = await guard(request)
  if (denied) return denied
  const providers = await readProviders()
  // 预设列表给前端渲染平台/模型下拉；去掉 apiKey 相关无敏感信息
  return json({ providers: publicProviders(providers), presets: AI_PLATFORM_PRESETS })
}

export async function PUT(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { providers?: unknown }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }
  if (!Array.isArray(body.providers)) return err('providers 必须是数组')

  const existing = await readProviders()
  const incoming = body.providers as Array<Record<string, unknown>>
  let sanitized: AiProviderConfig[]
  try {
    sanitized = incoming.map((p, i) => {
      const platformId = String(p.platformId ?? '').trim()
      const preset = getPlatformPreset(platformId)
      if (!preset) throw new Error('第 ' + (i + 1) + ' 项：未知平台 ' + platformId)

      const rawKey = String(p.apiKey ?? '')
      const keyIsMask = !rawKey || rawKey.includes('•')
      const apiKey = keyIsMask ? (existing[i]?.apiKey ?? '') : rawKey.trim()
      if (!apiKey) throw new Error(preset.name + '：请填写 API Key')

      const modelId = String(p.modelId ?? '').trim()
      if (!modelId) throw new Error(preset.name + '：请选择模型')
      if (!preset.models.some((m) => m.id === modelId)) {
        throw new Error(preset.name + '：模型 ' + modelId + ' 不在预设中')
      }

      return {
        platformId,
        apiKey,
        modelId,
        enabled: p.enabled !== false,
        allowFrontend: Boolean(p.allowFrontend),
      }
    })
  } catch (e) {
    return err('配置校验失败：' + (e as Error).message)
  }

  try {
    const payload = await getDb()
    await payload.updateGlobal({ slug: 'ai-models', overrideAccess: true, data: { providers: sanitized } as never })
    return json({ ok: true, providers: publicProviders(await readProviders()) })
  } catch (e) {
    return err('保存失败：' + (e as Error).message, 500)
  }
}

export async function POST(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { platformId?: unknown; prompt?: string }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }
  const platformId = String(body.platformId ?? '').trim()
  const providers = await readProviders()
  const provider = findByPlatform(providers, platformId)
  if (!provider) return err('找不到该平台的配置')

  const messages: ChatMessage[] = [
    { role: 'user', content: String(body.prompt ?? '').trim() || '请回复：连接成功' },
  ]
  try {
    const result = await callModel({ provider, messages, maxTokens: 256, signal: request.signal })
    return json(result)
  } catch (e) {
    return err('调用失败：' + (e as Error).message, 502)
  }
}
