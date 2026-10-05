import type { Payload } from 'payload'
import { errorJson, json, requireAdmin, toErrorResponse } from '../../../lib/comments-admin-guard'
import { listComments, type WalineCommentNode, type WalineStatus } from '../../../lib/waline-admin'

/**
 * 后台评论管理列表（仅文章评论）。
 *
 * GET /api/comments?status=waiting|approved|spam|all&page=1&pageSize=10&keyword=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 返回按「根评论 + 回复」组装的线程，外加 posts（评论 url → 文章标题），前端不再自己拼路径。
 * 单条审核动作在 /api/comments/[id]。服务端内部转调进程内 Waline（见 lib/waline-admin），
 * 管理员令牌绝不下发浏览器。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: WalineStatus[] = ['waiting', 'approved', 'spam', 'all']

const asDateText = (value: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? (value as string) : '')

/** 文章 URL 形如 /posts/{分类名}/{文章 id}/；只取末段数字 id，省掉分类名那段的编解码差异 */
function postIdFromUrl(url: string): string | null {
  let pathname = url
  try {
    pathname = new URL(url, 'http://local').pathname
  } catch {
    // 解析不了的按裸路径处理
  }
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2 || segments[0] !== 'posts') return null
  const id = segments[segments.length - 1]
  return /^\d+$/.test(id) ? id : null
}

/**
 * url → 文章标题。查不到（文章已彻底删除、或评论挂在非文章路径）就不进映射，
 * 前端回退显示裸路径，比显示「未知文章」更有用。
 */
async function postTitles(payload: Payload, rows: WalineCommentNode[]): Promise<Record<string, string>> {
  const urls = new Set<string>()
  const collect = (list: WalineCommentNode[]) => {
    for (const row of list) {
      urls.add(row.url)
      collect(row.replies)
    }
  }
  collect(rows)

  const ids = [...new Set([...urls].map(postIdFromUrl).filter((id): id is string => id !== null))]
  if (!ids.length) return {}

  // overrideAccess：审核台要看得到草稿/回收站里文章的标题，否则那些文章的评论只能显示路径
  const { docs } = await payload.find({
    collection: 'posts',
    where: { id: { in: ids } },
    limit: ids.length,
    select: { title: true },
    draft: true,
    trash: true,
    overrideAccess: true,
  })
  const titleById = new Map(docs.map((doc) => [String(doc.id), (doc as { title?: string }).title ?? '']))

  const map: Record<string, string> = {}
  for (const url of urls) {
    const id = postIdFromUrl(url)
    const title = id ? titleById.get(id) : undefined
    if (title) map[url] = title
  }
  return map
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response

  const params = new URL(request.url).searchParams
  const status = (params.get('status') ?? 'waiting') as WalineStatus
  if (!STATUSES.includes(status)) return errorJson('未知的评论状态筛选', 400)

  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 20) || 20))
  const keyword = (params.get('keyword') ?? '').trim().slice(0, 100)
  const from = asDateText(params.get('from'))
  const to = asDateText(params.get('to'))

  try {
    const result = await listComments({ status, page, pageSize, keyword, from, to })
    return json({ ...result, posts: await postTitles(guard.payload, result.rows) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
