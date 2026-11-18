/**
 * AI 模型服务层（服务端专用，绝不可被浏览器直接 import）。
 *
 * 职责：
 * 1. 从 ai-models global 读取供应商 / Key / 模型配置（绕过 access 直接读库，Key 只留在服务端）
 * 2. OpenAI 兼容协议调用 {baseURL}/chat/completions（硅基流动 / DeepSeek / 智谱 / OpenAI 官方通用）
 * 3. SSRF 防护：baseURL 必须是 https，且禁止指向内网/环回地址
 * 4. API Key 脱敏（给后台管理页展示）
 * 5. 前台调用的轻量限流
 */

import { getDb } from './blog-sync'

const CALL_TIMEOUT_MS = 60000

export interface AiModelDef {
  modelId: string
  displayName?: string | null
  free?: boolean | null
  contextLength?: number | null
  allowFrontend?: boolean | null
}

export interface AiProviderDef {
  name: string
  baseURL: string
  apiKey: string
  enabled?: boolean | null
  models?: AiModelDef[] | null
}

/** 读取 ai-models global 的 providers（服务端直连，忽略 access 限制） */
export async function readProviders(): Promise<AiProviderDef[]> {
  const payload = await getDb()
  const doc = await payload.findGlobal({ slug: 'ai-models', overrideAccess: true, depth: 0 }).catch(() => null)
  const providers = (doc as unknown as { providers?: AiProviderDef[] } | null)?.providers
  return Array.isArray(providers) ? providers : []
}

/** API Key 掩码：只保留前 4 后 4 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

/** 给后台管理页用的安全配置（Key 已脱敏） */
export function publicProviders(providers: AiProviderDef[]) {
  return providers.map((p, i) => ({
    index: i,
    name: p.name,
    baseURL: p.baseURL,
    apiKeyMasked: maskKey(p.apiKey ?? ''),
    enabled: Boolean(p.enabled),
    models: (p.models ?? []).map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName || m.modelId,
      free: Boolean(m.free),
      contextLength: m.contextLength ?? null,
      allowFrontend: Boolean(m.allowFrontend),
    })),
  }))
}

/** 校验 baseURL 安全：仅 https（本地 dev 放开 http 回环），拒绝内网地址；去掉尾部斜杠 */
export function assertSafeBaseURL(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Base URL 不是合法的地址')
  }
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

/** 按 provider + modelId 调用 OpenAI 兼容的 chat/completions */
export async function callModel(opts: {
  provider: AiProviderDef
  modelId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<ChatResult> {
  const { provider, modelId, messages } = opts
  const baseURL = assertSafeBaseURL(provider.baseURL ?? '')
  if (!provider.apiKey) throw new Error('该供应商未配置 API Key')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  const started = Date.now()
  try {
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + provider.apiKey,
      },
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
      try {
        const j = JSON.parse(text)
        detail = j?.error?.message || j?.message || detail
      } catch { /* 非 JSON 原样截断 */ }
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
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
      latencyMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 从 providers 中定位启用的模型，返回其所属供应商 */
export function findModel(providers: AiProviderDef[], modelId: string, opts: { frontendOnly?: boolean } = {}) {
  for (const provider of providers) {
    if (provider.enabled === false) continue
    const model = (provider.models ?? []).find((m) => m.modelId === modelId)
    if (!model) continue
    if (opts.frontendOnly && !model.allowFrontend) continue
    return { provider, model }
  }
  return null
}

/** 前台调用限流：按 IP 滑动窗口，每 60s 最多 10 次（进程内计数） */
const rateBuckets = new Map<string, number[]>()
const FRONTEND_RATE_LIMIT = 10
const FRONTEND_RATE_WINDOW_MS = 60000

export function checkFrontendRateLimit(ip: string): boolean {
  const now = Date.now()
  const arr = (rateBuckets.get(ip) ?? []).filter((t) => now - t < FRONTEND_RATE_WINDOW_MS)
  if (arr.length >= FRONTEND_RATE_LIMIT) {
    rateBuckets.set(ip, arr)
    return false
  }
  arr.push(now)
  rateBuckets.set(ip, arr)
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] >= FRONTEND_RATE_WINDOW_MS) rateBuckets.delete(k)
    }
  }
  return true
}
