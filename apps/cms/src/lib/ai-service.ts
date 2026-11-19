/**
 * AI 模型服务层（服务端专用，绝不可被浏览器直接 import）。
 * 存：platformId + apiKey + modelIds（多选）+ currentModelId（可切换）+ 开关。
 * 平台的 Base URL / 模型拉取全部来自 shared/ai-presets，用户只填 Key。
 */

import { getPlatformPreset, getPresetModel } from 'cloud-blog/shared/ai-presets'
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
  const currentModelId =
    (typeof p.currentModelId === 'string' && p.currentModelId) || modelIds[0] || legacyModelId || ''
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

/**
 * 序列化给管理员后台的 providers。
 * includePlainKey=true 时额外返回明文 apiKey —— 仅在已鉴权的管理员接口调用，
 * 用于编辑弹窗里真实展示已保存的 Key；默认只返回脱敏串，避免误传到前台。
 */
export function publicProviders(providers: AiProviderDef[], includePlainKey = false) {
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
      ...(includePlainKey ? { apiKey: p.apiKey ?? '' } : {}),
      modelIds: p.modelIds ?? [],
      currentModelId: p.currentModelId ?? '',
      enabled: Boolean(p.enabled),
      allowFrontend: Boolean(p.allowFrontend),
    }
  })
}

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
      try {
        const j = JSON.parse(text)
        detail = j?.error?.message || j?.message || detail
      } catch {}
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

/** 远程拉取到的模型（含免费/价格标注） */
export interface RemoteModel {
  id: string
  name: string
  /** 官方定价页明确免费 */
  free: boolean
  /** 输入单价（元/百万 Tokens），undefined 表示未知 */
  inputPrice?: number
  /** 输出单价（元/百万 Tokens），undefined 表示未知 */
  outputPrice?: number
  /** 上下文长度 */
  context?: string
  /** 备注（免费说明等） */
  note?: string
  /** 来源：remote=平台 /models 返回，preset=本地预设补充 */
  source: 'remote' | 'preset'
  /** 可用性探测结果：ok=实测可调用，failed=实测失败（已被剔除），unknown=未探测/无法判断 */
  verified?: 'ok' | 'unknown'
}

/** 判断是否对话类模型（只有这类能用 chat/completions 探测） */
function isChatModel(id: string): boolean {
  const lower = id.toLowerCase()
  // 向量 / 重排 / 语音 / 图像 / 视频 / OCR 等非对话模型跳过探测
  if (
    /embedding|rerank|^bge-|^m3e-|tts|asr|voice|realtime|cogview|cogvideo|vidu|dall-e|whisper|ocr|moderation|image-|^glm-4v-flash$/.test(
      lower,
    )
  ) {
    return false
  }
  return true
}

/**
 * 探测单个模型是否真的能调用：发一个 max_tokens=1 的最小对话请求。
 * 只有在「明确说明模型不存在」时才判定不可用，其余错误（限流、余额、参数）
 * 都保守地认为模型存在，避免误杀。
 */
async function probeModel(baseURL: string, apiKey: string, modelId: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (res.ok) return true
    const text = await res.text().catch(() => '')
    const lower = text.toLowerCase()
    // 明确表示模型不存在 → 判定不可用
    if (res.status === 404) return false
    if (
      lower.includes('model') &&
      (lower.includes('not exist') ||
        lower.includes('not found') ||
        lower.includes('invalid model') ||
        lower.includes('no such model') ||
        lower.includes('does not exist') ||
        lower.includes('不存在') ||
        lower.includes('已下线'))
    ) {
      return false
    }
    // 其他情况（401/403/429/400/5xx）→ 模型本身存在，只是这次调用失败了
    return true
  } catch {
    // 超时 / 网络错误 → 无法判断，保留
    return true
  } finally {
    clearTimeout(timer)
  }
}

/** 并发受限地探测一批模型 */
async function probeModels(
  baseURL: string,
  apiKey: string,
  modelIds: string[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, boolean>> {
  const concurrency = opts.concurrency ?? 6
  const timeoutMs = opts.timeoutMs ?? 12000
  const results = new Map<string, boolean>()
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, modelIds.length) }, async () => {
    while (cursor < modelIds.length) {
      const idx = cursor++
      const id = modelIds[idx]
      results.set(id, await probeModel(baseURL, apiKey, id, timeoutMs))
    }
  })
  await Promise.all(workers)
  return results
}

/** 从官方 /models 接口取模型 id 列表 */
async function listModelsFromApi(
  baseURL: string,
  apiKey: string,
  modelsPath: string,
): Promise<Array<{ id: string; name?: string }>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)
  try {
    const res = await fetch(baseURL + modelsPath, {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 300)
      try {
        const j = JSON.parse(text)
        detail = j?.error?.message || j?.message || detail
      } catch {}
      throw new Error('平台返回 ' + res.status + '：' + detail)
    }
    const json = JSON.parse(text) as {
      data?: Array<{ id?: string; name?: string }>
      models?: Array<{ id?: string; name?: string }>
    }
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []
    return list
      .map((m) => ({ id: String(m.id ?? '').trim(), name: m.name ? String(m.name) : undefined }))
      .filter((m) => m.id)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取平台全部可用模型。
 *
 * 流程：
 * 1. 调官方 /models 拿「当前账号可调用的全部模型」（含主推 + 老模型，由平台决定）；
 * 2. 并上本地预设作为兜底/元数据源（预设只查免费与价格，不轻易扩充清单）；
 * 3. 对每个对话类模型发最小请求做「可用性探测」，明确不可用的剔除；
 * 4. 用预设标注免费 / 收费价格。
 */
export async function fetchRemoteModels(platformId: string, apiKey: string): Promise<RemoteModel[]> {
  const preset = getPlatformPreset(platformId)
  if (!preset) throw new Error('未知平台')
  const key = apiKey.trim()
  if (!key) throw new Error('请先填写 API Key')
  const baseURL = assertSafeBaseURL(preset.baseURL)

  // 1) 官方接口拉取
  let remote: Array<{ id: string; name?: string }> = []
  let remoteFailed = false
  try {
    remote = await listModelsFromApi(baseURL, key, preset.modelsPath ?? '/models')
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    remoteFailed = true
  }

  const seen = new Set<string>()
  const merged: RemoteModel[] = []

  const enrich = (id: string, fallbackName?: string, source: 'remote' | 'preset' = 'remote'): RemoteModel => {
    const p = getPresetModel(platformId, id)
    return {
      id,
      name: p?.name || fallbackName || id,
      free: Boolean(p?.free),
      inputPrice: p?.inputPrice,
      outputPrice: p?.outputPrice,
      context: p?.context,
      note: p?.note,
      source,
      verified: 'unknown',
    }
  }

  // 2) 官方返回的模型（这是主清单）
  for (const m of remote) {
    if (!m.id || seen.has(m.id)) continue
    seen.add(m.id)
    merged.push(enrich(m.id, m.name, 'remote'))
  }

  // 3) 预设补充：仅在「官方接口失败」或「平台允许补充」时使用
  //    官方接口成功时不额外补预设，避免带入平台已下架的模型。
  const shouldBackfill = remoteFailed || !preset.trustRemoteModels
  if (shouldBackfill) {
    for (const m of preset.models) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(enrich(m.id, m.name, 'preset'))
    }
  }

  if (!merged.length) {
    throw new Error('该账号没有可用模型，请检查 API Key 权限')
  }

  // 4) 可用性探测。
  //    /models 返回的模型理论上可调用，但部分平台会把已下线模型保留在列表里映射到新模型，
  //    所以对「预设来源」的模型必探，对「remote 来源」的模型按上限抽样探测。
  const PROBE_LIMIT = 40
  const presetSourced = merged.filter((m) => m.source === 'preset' && isChatModel(m.id))
  const remoteSourced = merged.filter((m) => m.source === 'remote' && isChatModel(m.id))
  const toProbe = [...presetSourced, ...remoteSourced.slice(0, PROBE_LIMIT)].map((m) => m.id)
  if (toProbe.length) {
    const probeResult = await probeModels(baseURL, key, toProbe)
    for (let i = merged.length - 1; i >= 0; i--) {
      const m = merged[i]
      const ok = probeResult.get(m.id)
      if (ok === false) {
        merged.splice(i, 1)
      } else if (ok === true) {
        m.verified = 'ok'
      }
    }
  }

  // 5) 排序：免费优先，其次可用性，然后按名称
  merged.sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1
    return a.id.localeCompare(b.id)
  })
  return merged
}

/** 前台限流：按 IP 每 60s 10 次 */
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
