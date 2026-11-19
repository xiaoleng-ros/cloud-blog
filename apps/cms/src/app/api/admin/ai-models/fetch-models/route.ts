/** 用 API Key 从平台实时拉取可用模型列表（管理员鉴权）。 */

import { NextResponse } from 'next/server'

// 拉取时会并发探测模型可用性，耗时比单纯列模型长，放宽函数超时上限
export const maxDuration = 300
export const dynamic = 'force-dynamic'

import { getDb } from '../../../../../lib/blog-sync'
import { verifyRequestUser } from '../../../../../lib/feishu-session'
import { isSameOriginRequest } from '../../../../../lib/same-origin'
import { fetchRemoteModels, findByPlatform, readProviders } from '../../../../../lib/ai-service'

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) return NextResponse.json({ error: '未登录或会话已失效' }, { status: 401 })

  let body: { platformId?: unknown; apiKey?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }
  const platformId = String(body.platformId ?? '').trim()
  let apiKey = String(body.apiKey ?? '').trim()
  if (!platformId) return NextResponse.json({ error: '缺少平台' }, { status: 400 })

  // 编辑场景：Key 输入框留空（或仍是脱敏占位）时，沿用该平台已保存的 Key。
  // 这样重新拉取模型/保存时不必每次重新输入明文 Key。
  if (!apiKey || apiKey.includes('•')) {
    const saved = findByPlatform(await readProviders(), platformId)
    if (saved?.apiKey) apiKey = saved.apiKey
  }
  if (!apiKey) return NextResponse.json({ error: '请先填写 API Key' }, { status: 400 })

  try {
    const models = await fetchRemoteModels(platformId, apiKey)
    return NextResponse.json({ models })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
