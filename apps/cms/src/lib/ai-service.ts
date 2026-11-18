/**
 * AI 模型服务层（服务端专用，绝不可被浏览器直接 import）。
 *
 * 存储结构极简：每个配置只存 platformId + apiKey + modelId + 开关。
 * 平台的名称 / Base URL / 可用模型全部来自 shared/ai-presets 预设，用户只填 Key。
 */

import { getPlatformPreset } from 'cloud-blog/shared/ai-presets'
import { getDb } from './blog-sync'

const CALL_TIMEOUT_MS = 60000

/** 数据库里保存的最小配置 */
export interface AiProviderConfig {
  platformId: string
  apiKey: string
  modelId: string
  enabled?: boolean | null
  allowFrontend?: boolean | null
}

/** 运行时补全后的供应商（含预设信息） */
export interface AiProviderDef extends AiProviderConfig {
  name: string
  baseURL: string
}

/** 读取配置并用预设补全 baseURL / 名称 */
export async function readProviders(): Promise<AiProviderDef[]> {
  const payload = await getDb()
  const doc = await payload.findGlobal({ slug: 'ai-models', overrideAccess: true, depth: 0 }).catch(() => null)
  const raw = (doc as unknown as { providers?: AiProviderConfig[] } | null)?.providers
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const preset = getPlatformPreset(p.platformId)
    return {
      ...p,
      name: preset?.name ?? p.platformId,
      baseURL: preset?.baseURL ?? '',
    }
  })
}

/** API Key 掩码：只保留前 4 后 4 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

/** 给后台管理页用的安全配置（Key 脱敏 + 带预设模型列表） */
export function publicProviders(providers: AiProviderDef[]) {
  return providers.map((p, i) => {
    const preset = getPlatformPreset(p.platformId)
    return {
      index: i,
      platformId: p.platformId,
      platformName: p.name,
      keyUrl: preset?.keyUrl ?? '',
      docs: preset?.docs ?? '',
      availableModels: preset?.models ?? [],
      apiKeyMasked: maskKey(p.apiKey ?? ''),
      modelId: p.modelId,
      enabled: Boolean(p.enabled),
      allowFrontend: Boolean(p.allowFrontend),
    }
  })
}

/** 校验 baseURL 安全（预设地址都是 https；仅本地回环允许 http） */
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  model: string
  latencyMs: number
}

/** 调用配置中选中的模型 */
export async function callModel(opts: {
  provider: AiProviderDef
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<ChatResult> {
  const { provider, messages } = opts
  const modelId = provider.modelId
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
    const content = json.choices?.[0]?.message?.content ?? ''
    return {
      content,
      model: json.model || modelId,
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens }
        : undefined,
      latencyMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 定位启用的配置（frontendOnly 时要求是「允许前台调用」的） */
export function findProvider(providers: AiProviderDef[], opts: { frontendOnly?: boolean } = {}) {
  for (const provider of providers) {
    if (provider.enabled === false) continue
    if (opts.frontendOnly && !provider.allowFrontend) continue
    if (!provider.modelId) continue
    return provider
  }
  return null
}

/** 按平台 id 找配置（用于后台测试：指定 platformId 而非数组下标） */
export function findByPlatform(providers: AiProviderDef[], platformId: string, opts: { frontendOnly?: boolean } = {}) {
  for (const provider of providers) {
    if (provider.platformId !== platformId) continue
    if (provider.enabled === false) continue
    if (opts.frontendOnly && !provider.allowFrontend) continue
    return provider
  }
  return null
}

/** 前台调用限流：按 IP 滑动窗口，每 60s 最多 10 次 */
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
