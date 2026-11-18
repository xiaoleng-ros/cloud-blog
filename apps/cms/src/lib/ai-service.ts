/**
 * AI 模型服务层（服务端专用，绝不可被浏览器直接 import）。
 * 存：platformId + apiKey + modelIds（多选）+ currentModelId（可切换）+ 开关。
 * 平台的 Base URL / 模型拉取全部来自 shared/ai-presets，用户只填 Key。
 */

import { getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { getDb } from './blog-sync'

const CALL_TIMEOUT_MS = 60000
const MODELS_TIMEOUT_MS = 20000

export interface AiProviderConfig {
  platformId: string
  apiKey: string
  modelIds?: string[] | null
  currentModelId?: string | null
  enabled?: boolean | null
  allowFrontend?: boolean | null
}

export interface AiProviderDef extends AiProviderConfig {
  name: string
  baseURL: string
}

/** 兼容旧数据：老结构是 modelId 单值，迁移到 modelIds/currentModelId */
function normalize(p: Record<string, unknown>): AiProviderConfig {
  const legacyModelId = typeof p.modelId === 'string' ? p.modelId : ''
  const rawIds = Array.isArray(p.modelIds) ? p.modelIds.filter((x): x is string => typeof x === 'string') : []
  const modelIds = rawIds.length ? rawIds : legacyModelId ? [legacyModelId] : []
  const currentModelId = (typeof p.currentModelId === 'string' && p.currentModelId) || modelIds[0] || legacyModelId || ''
  return {
    platformId: String(p.platformId ?? ''),
    apiKey: String(p.apiKey ?? ''),
    modelIds,
    currentModelId,
    enabled: p.enabled !== false,
    allowFrontend: Boolean(p.allowFrontend),
  }
}

export async function readProviders(): Promise<AiProviderDef[]> {
  const payload = await getDb()
  const doc = await payload.findGlobal({ slug: 'ai-models', overrideAccess: true, depth: 0 }).catch(() => null)
  const raw = (doc as unknown as { providers?: Record<string, unknown>[] } | null)?.providers
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const cfg = normalize(p)
    const preset = getPlatformPreset(cfg.platformId)
    return { ...cfg, name: preset?.name ?? cfg.platformId, baseURL: preset?.baseURL ?? '' }
  })
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

export function publicProviders(providers: AiProviderDef[]) {
  return providers.map((p, i) => {
    const preset = getPlatformPreset(p.platformId)
    return {
      index: i,
      platformId: p.platformId,
      platformName: p.name,
      short: preset?.short ?? p.platformId.slice(0, 2).toUpperCase(),
      color: preset?.color ?? '#5c6b82',
      baseURL: preset?.baseURL ?? p.baseURL,
      keyUrl: preset?.keyUrl ?? '',
      docs: preset?.docs ?? '',
      apiKeyMasked: maskKey(p.apiKey ?? ''),
      modelIds: p.modelIds ?? [],
      currentModelId: p.currentModelId ?? '',
      enabled: Boolean(p.enabled),
      allowFrontend: Boolean(p.allowFrontend),
    }
  })
}

export function assertSafeBaseURL(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Base URL 不是合法的地址') }
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  const isDev = process.env.NODE_ENV !== 'production'
  if (url.protocol !== 'https:' && !(isDev && isLoopback && url.protocol === 'http:')) {
    throw new Error('Base URL 必须使用 https（本地开发允许 http 回环地址）')
  }
  if (!isDev && isLoopback) throw new Error('Base URL 不能指向内网地址')
  let out = raw
  while (out.endsWith('/')) out = out.slice(0, -1)
  return out
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult {
  content: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  model: string
  latencyMs: number
}

/** 调用模型：modelId 可覆盖当前模型（用于切换模型调用） */
export async function callModel(opts: {
  provider: AiProviderDef
  modelId?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<ChatResult> {
  const { provider, messages } = opts
  const modelId = opts.modelId || provider.currentModelId || (provider.modelIds?.[0] ?? '')
  if (!modelId) throw new Error('该平台没有可用模型')
  const baseURL = assertSafeBaseURL(provider.baseURL ?? '')
  if (!provider.apiKey) throw new Error('该平台未配置 API Key')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  const started = Date.now()
  try {
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.apiKey },
      body: JSON.stringify({
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        stream: false,
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 500)
      try { const j = JSON.parse(text); detail = j?.error?.message || j?.message || detail } catch {}
      throw new Error('模型接口返回 ' + res.status + '：' + detail)
    }
    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      model?: string
    }
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      model: json.model || modelId,
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens }
        : undefined,
      latencyMs: Date.now() - started,
    }
  } finally { clearTimeout(timer) }
}

/** 按平台 id 找已配置平台 */
export function findByPlatform(providers: AiProviderDef[], platformId: string, opts: { frontendOnly?: boolean } = {}) {
  for (const provider of providers) {
    if (provider.platformId !== platformId) continue
    if (provider.enabled === false) continue
    if (opts.frontendOnly && !provider.allowFrontend) continue
    return provider
  }
  return null
}

/** 找第一个可给前台用的平台 */
export function findFrontendProvider(providers: AiProviderDef[]) {
  for (const provider of providers) {
    if (provider.enabled === false || !provider.allowFrontend) continue
    if ((provider.modelIds?.length ?? 0) === 0) continue
    return provider
  }
  return null
}

/** 用 Key 从平台实时拉取可用模型列表（OpenAI 兼容 /models） */
export async function fetchRemoteModels(platformId: string, apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const preset = getPlatformPreset(platformId)
  if (!preset) throw new Error('未知平台')
  if (!apiKey.trim()) throw new Error('请先填写 API Key')
  const baseURL = assertSafeBaseURL(preset.baseURL)
  const url = baseURL + (preset.modelsPath ?? '/models')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + apiKey.trim() },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 300)
      try { const j = JSON.parse(text); detail = j?.error?.message || j?.message || detail } catch {}
      throw new Error('平台返回 ' + res.status + '：' + detail)
    }
    const json = JSON.parse(text) as {
      data?: Array<{ id?: string; name?: string; owned_by?: string }>
      models?: Array<{ id?: string; name?: string }>
    }
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []
    const models = list
      .map((m) => ({ id: String(m.id ?? '').trim(), name: String(m.name ?? m.id ?? '').trim() }))
      .filter((m) => m.id)
    // 去重
    const seen = new Set<string>()
    return models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  } finally { clearTimeout(timer) }
}

/** 前台限流：按 IP 每 60s 10 次 */
const rateBuckets = new Map<string, number[]>()
const FRONTEND_RATE_LIMIT = 10
const FRONTEND_RATE_WINDOW_MS = 60000
export function checkFrontendRateLimit(ip: string): boolean {
  const now = Date.now()
  const arr = (rateBuckets.get(ip) ?? []).filter((t) => now - t < FRONTEND_RATE_WINDOW_MS)
  if (arr.length >= FRONTEND_RATE_LIMIT) { rateBuckets.set(ip, arr); return false }
  arr.push(now)
  rateBuckets.set(ip, arr)
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] >= FRONTEND_RATE_WINDOW_MS) rateBuckets.delete(k)
    }
  }
  return true
}
