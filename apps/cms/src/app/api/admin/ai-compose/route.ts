/**
 * 后台 AI 写作接口（管理员鉴权）：给 Markdown 编辑器 / 发布弹窗提供 AI 能力。
 * - generate：按用户给的主题/要求生成一篇完整 Markdown 文章
 * - optimize：把用户当前正文交给模型润色/优化，只返回优化后的 Markdown
 * - meta：根据正文生成标题 + 摘要，返回 JSON { title, description }
 * 复用后台已配置的模型（不受「允许前台调用」开关限制），Key 只留在服务端。
 */

import { NextResponse } from 'next/server'

import { getDb } from '../../../../lib/blog-sync'
import { verifyRequestUser } from '../../../../lib/feishu-session'
import { isSameOriginRequest } from '../../../../lib/same-origin'
import { callModel, findByPlatform, readProviders, type ChatMessage } from '../../../../lib/ai-service'

const json = (data: unknown, status = 200) => NextResponse.json(data, { status })
const err = (message: string, status = 400) => json({ error: message }, status)

const GENERATE_SYSTEM = `你是一位资深的中文技术博客作者。请根据用户给出的主题与要求，撰写一篇结构清晰、可读性强的完整博客文章。
要求：
- 使用 Markdown 语法输出，包含合适的标题层级（# / ## / ###）、段落、列表、必要的代码块。
- 语言自然、有观点、避免空话套话；内容详实但不要冗长。
- 只输出文章正文的 Markdown，不要在开头或结尾加任何解释说明，不要用代码围栏把整篇文章包起来。`

const OPTIMIZE_SYSTEM = `你是一位资深的中文技术博客编辑。用户会给你一篇 Markdown 文章，请在不改变原意与事实的前提下优化它。
优化方向：
- 修正错别字、病句与标点，让表达更准确流畅；
- 改善段落结构与标题层级，让逻辑更清晰；
- 适当精简冗余表述，必要时补充衔接句；
- 保留原有的 Markdown 结构、代码块、链接与图片，不要改动技术内容。
只输出优化后的完整 Markdown 正文，不要输出任何解释说明，也不要用代码围栏把整篇文章包起来。`

const META_SYSTEM = `你是一位资深的中文博客编辑。请根据用户给出的文章正文，生成：
1. 一个简洁、准确、吸引人的标题（不超过 30 个字）；
2. 一段 60-120 字的摘要，概括文章核心内容，让人一眼知道文章讲了什么。

严格只输出一个 JSON 对象，格式为 {"title": "标题文本", "description": "摘要文本"}，不要输出任何其他文字，也不要用代码围栏包裹。`

/** 从模型输出里解析 { title, description }，容忍代码围栏与前后废话 */
function parseMetaResult(rawText: string, model: string) {
  let title = ''
  let description = ''
  const trimmed = rawText.trim()
  const fence = trimmed.indexOf(String.fromCharCode(96, 96, 96))
  let candidate = trimmed
  if (fence >= 0) {
    const after = trimmed.slice(fence + 3).replace(/^json\s*/i, '')
    const end = after.indexOf(String.fromCharCode(96, 96, 96))
    candidate = (end >= 0 ? after.slice(0, end) : after).trim()
  }
  try {
    const parsed = JSON.parse(candidate) as { title?: unknown; description?: unknown }
    title = String(parsed.title ?? '').trim()
    description = String(parsed.description ?? '').trim()
  } catch {
    for (const line of trimmed.split(String.fromCharCode(10))) {
      const m = line.match(/^(标题|摘要)\s*[：:]\s*(.+)$/)
      if (!m) continue
      if (m[1] === '标题') title = m[2].trim()
      else description = m[2].trim()
    }
  }
  if (!title && !description) return err('模型未能生成有效的标题与摘要', 502)
  return json({ title, description, model })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err('跨站请求被拒绝', 403)
  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) return err('未登录或会话已失效', 401)

  let body: {
    action?: unknown
    prompt?: unknown
    content?: unknown
    platformId?: unknown
    modelId?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return err('请求体必须是 JSON')
  }

  const action = String(body.action ?? '')
  if (action !== 'generate' && action !== 'optimize' && action !== 'meta') {
    return err('action 必须是 generate / optimize / meta')
  }

  const providers = await readProviders()
  const platformId = String(body.platformId ?? '').trim()
  // meta（发布弹窗一键生成标题/摘要）不需要用户选模型：
  // 指定了平台就用它，否则自动挑第一个启用的平台，模型用其 currentModelId。
  let provider = platformId ? findByPlatform(providers, platformId) : null
  if (!provider) {
    provider = providers.find((p) => p.enabled !== false && (p.modelIds?.length ?? 0) > 0) ?? null
  }
  if (!provider) return err('没有可用的 AI 模型，请先在后台「AI 模型」页配置并启用一个平台')

  const modelId = body.modelId ? String(body.modelId).trim() : undefined
  if (modelId && !(provider.modelIds ?? []).includes(modelId)) return err('该模型不在此平台已选模型中')

  const messages: ChatMessage[] = []
  if (action === 'generate') {
    const prompt = String(body.prompt ?? '').trim()
    if (!prompt) return err('请填写文章主题或写作要求')
    if (prompt.length > 4000) return err('写作要求过长（最多 4000 字）')
    messages.push({ role: 'system', content: GENERATE_SYSTEM })
    messages.push({ role: 'user', content: prompt })
  } else {
    const content = String(body.content ?? '').trim()
    if (!content) {
      return err(action === 'meta' ? '编辑器里还没有内容，请先写点什么再生成标题摘要' : '编辑器里还没有内容，请先写点什么再优化')
    }
    if (content.length > 50000) return err('文章内容过长（最多 50000 字）')
    messages.push({ role: 'system', content: action === 'meta' ? META_SYSTEM : OPTIMIZE_SYSTEM })
    // 标题/摘要只需正文开头即可，没必要把整篇塞进去
    messages.push({ role: 'user', content: content.slice(0, 20000) })
  }

  try {
    const result = await callModel({
      provider,
      modelId,
      messages,
      temperature: action === 'generate' ? 0.8 : 0.3,
      maxTokens: action === 'meta' ? 512 : 4096,
      signal: request.signal,
    })
    if (action === 'meta') return parseMetaResult(result.content, result.model)
    return json({ content: result.content, model: result.model, latencyMs: result.latencyMs })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return err('请求已取消', 499)
    return err('模型调用失败：' + (e as Error).message, 502)
  }
}
