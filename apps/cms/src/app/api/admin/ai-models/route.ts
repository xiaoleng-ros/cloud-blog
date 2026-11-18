/**
 * 后台「AI 模型」管理 API（同源，管理员登录鉴权）。
 *
 * - GET  /api/admin/ai-models        读取配置（API Key 脱敏）
 * - PUT  /api/admin/ai-models        保存配置（掩码 Key 视为「不修改」，保留原值）
 * - POST /api/admin/ai-models/test   测试调用指定供应商 + 模型
 *
 * 所有写操作都做同源校验（防 CSRF）+ verifyRequestUser（登录态）。
 */

import { NextResponse } from 'next/server'

import { getDb } from '../../../../lib/blog-sync'
import { verifyRequestUser } from '../../../../lib/feishu-session'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import {
  assertSafeBaseURL,
  callModel,
  findModel,
  publicProviders,
  readProviders,
  type AiProviderDef,
  type ChatMessage,
} from '../../../../lib/ai-service'

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
const err = (message: string, status = 400) => json({ error: message }, status)

/** 统一鉴权：同源 + 登录；失败返回 Response，成功返回 null */
async function guard(request: Request) {
  if (!isSameOriginRequest(request)) return err('跨站请求被拒绝', 403)
  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) return err('未登录或会话已失效', 401)
  return null
}

/** GET：读取脱敏配置 */
export async function GET(request: Request) {
  const denied = await guard(request)
  if (denied) return denied
  const providers = await readProviders()
  return json({ providers: publicProviders(providers) })
}

/** PUT：保存配置。前端回传的 apiKey 若为掩码则保留库中原值 */
export async function PUT(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { providers?: unknown }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }
  if (!Array.isArray(body.providers)) return err('providers 必须是数组')

  const existing = await readProviders()
  const incoming = body.providers as Array<Record<string, unknown>>
  let sanitized: AiProviderDef[]
  try {
    sanitized = incoming.map((p, i) => {
    const name = String(p.name ?? '').trim()
    const baseURL = String(p.baseURL ?? '').trim()
    if (!name) throw new Error('第 ' + (i + 1) + ' 个供应商缺少名称')
    let checkedBase = ''
    try { checkedBase = assertSafeBaseURL(baseURL) } catch (e) { throw new Error(name + '：' + (e as Error).message) }

    // 掩码值（含 • 或前端传的 apiKeyMasked）视为不修改，沿用原 key
    const rawKey = String(p.apiKey ?? '')
    const keyIsMask = !rawKey || rawKey.includes('•')
    const apiKey = keyIsMask ? (existing[i]?.apiKey ?? '') : rawKey.trim()

    const rawModels = Array.isArray(p.models) ? (p.models as Array<Record<string, unknown>>) : []
    const models = rawModels.map((m) => ({
      modelId: String(m.modelId ?? '').trim(),
      displayName: String(m.displayName ?? '').trim(),
      free: Boolean(m.free),
      contextLength: m.contextLength == null ? null : Number(m.contextLength) || null,
      allowFrontend: Boolean(m.allowFrontend),
    })).filter((m) => m.modelId)

    return {
      name,
      baseURL: checkedBase,
      apiKey,
      enabled: p.enabled !== false,
      models,
    }
    })
  } catch (e) {
    return err('配置校验失败：' + (e as Error).message)
  }

  try {
    const payload = await getDb()
    await payload.updateGlobal({
      slug: 'ai-models',
      overrideAccess: true,
      data: { providers: sanitized } as never,
    })
    return json({ ok: true, providers: publicProviders(sanitized) })
  } catch (e) {
    return err('保存失败：' + (e as Error).message, 500)
  }
}

/** POST /test：测试调用指定供应商（按 index）与模型 */
export async function POST(request: Request) {
  const denied = await guard(request)
  if (denied) return denied

  let body: { providerIndex?: number; modelId?: string; prompt?: string }
  try { body = await request.json() } catch { return err('请求体必须是 JSON') }
  const providers = await readProviders()
  const provider = providers[Number(body.providerIndex)]
  if (!provider) return err('找不到该供应商')
  const modelId = String(body.modelId ?? '').trim()
  if (!modelId) return err('缺少模型 ID')
  if (!findModel([provider], modelId)) return err('该模型不属于此供应商')

  const messages: ChatMessage[] = [
    { role: 'user', content: String(body.prompt ?? '').trim() || '请回复：连接成功' },
  ]
  try {
    const result = await callModel({ provider, modelId, messages, maxTokens: 256, signal: request.signal })
    return json(result)
  } catch (e) {
    return err('调用失败：' + (e as Error).message, 502)
  }
}
