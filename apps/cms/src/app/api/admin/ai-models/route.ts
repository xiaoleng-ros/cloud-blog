/**
 * 后台 AI 模型管理 API（同源，管理员登录鉴权）。
 * GET                          读取配置（Key 脱敏）+ 平台预设
 * PUT                          保存配置（platformId + Key + modelIds + currentModelId + 开关）
 * POST                         测试调用（可传 modelId 切换模型）
 * POST /api/admin/ai-models/fetch-models  用 Key 从平台拉取可用模型列表
 */

import { NextResponse } from 'next/server'

import { AI_PLATFORM_PRESETS, getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { getDb } from '../../../../lib/blog-sync'
import { verifyRequestUser } from '../../../../lib/feishu-session'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  callModel,
  fetchRemoteModels,
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
  // 已通过管理员鉴权：返回明文 Key，供编辑弹窗真实展示 / 直接复用。
  return json({ providers: publicProviders(await readProviders(), true), presets: AI_PLATFORM_PRESETS })
}

export async function PUT(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { providers?: unknown }
  try {
    body = await request.json()
  } catch {
    return err('请求体必须是 JSON')
  }
  if (!Array.isArray(body.providers)) return err('providers 必须是数组')

  const existing = await readProviders()
  const incoming = body.providers as Array<Record<string, unknown>>
  let sanitized: AiProviderConfig[]
  try {
    sanitized = incoming.map((p, i) => {
      const platformId = String(p.platformId ?? '').trim()
      const preset = getPlatformPreset(platformId)
      if (!preset) throw new Error('第 ' + (i + 1) + ' 项：未知平台 ' + platformId)

      // 前端从 GET 拿到的是 apiKeyMasked（脱敏），从弹窗新增/修改时提交 apiKey（明文）。
      // 两者都要接受：掩码值代表「沿用已保存的 Key」，明文代表「替换为这个 Key」。
      const rawKey = String(p.apiKey ?? p.apiKeyMasked ?? '').trim()
      const keyIsMask = !rawKey || rawKey.includes('•')
      // 掩码时优先按平台匹配已存 Key，其次按索引兜底（兼容老的顺序依赖）
      const prevByPlatform = existing.find((e) => e.platformId === platformId)
      const apiKey = keyIsMask ? (prevByPlatform?.apiKey ?? existing[i]?.apiKey ?? '') : rawKey
      if (!apiKey) throw new Error(preset.name + '：请填写 API Key')

      const modelIdsRaw = Array.isArray(p.modelIds) ? p.modelIds : []
      const modelIds = modelIdsRaw.map((x) => String(x).trim()).filter(Boolean)
      if (!modelIds.length) throw new Error(preset.name + '：请至少选择一个模型')

      let currentModelId = String(p.currentModelId ?? '').trim()
      if (!currentModelId || !modelIds.includes(currentModelId)) currentModelId = modelIds[0]

      return {
        platformId,
        apiKey,
        modelIds,
        currentModelId,
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
    const after = await readProviders()
    return json({ ok: true, providers: publicProviders(after, true) })
  } catch (e) {
    // 把 payload 校验错误的细节打出来，便于排查保存失败原因
    const detail = e as Error & { data?: unknown }
    console.error('[ai-models] 保存失败', detail?.message, JSON.stringify(detail?.data ?? null))
    return err('保存失败：' + (e as Error).message, 500)
  }
}

export async function POST(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { platformId?: unknown; modelId?: unknown; prompt?: string }
  try {
    body = await request.json()
  } catch {
    return err('请求体必须是 JSON')
  }
  const platformId = String(body.platformId ?? '').trim()
  const providers = await readProviders()
  const provider = findByPlatform(providers, platformId)
  if (!provider) return err('找不到该平台的配置')

  const modelId = body.modelId ? String(body.modelId).trim() : undefined
  if (modelId && !(provider.modelIds ?? []).includes(modelId)) return err('该模型不在此平台已选模型中')

  const messages: ChatMessage[] = [{ role: 'user', content: String(body.prompt ?? '').trim() || '请回复：连接成功' }]
  try {
    const result = await callModel({ provider, modelId, messages, maxTokens: 256, signal: request.signal })
    return json(result)
  } catch (e) {
    return err('调用失败：' + (e as Error).message, 502)
  }
}
