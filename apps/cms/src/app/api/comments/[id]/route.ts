import { errorJson, json, requireAdmin, toErrorResponse } from '../../../../lib/comments-admin-guard'
import { removeComment, setCommentStatus } from '../../../../lib/waline-admin'

/**
 * 单条评论的审核动作。
 *
 * PUT    /api/comments/:id  body: { status: 'approved'|'spam'|'waiting' }
 * DELETE /api/comments/:id
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['approved', 'spam', 'waiting'] as const

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, true)
  if (!guard.ok) return guard.response

  const { id } = await params
  const commentId = Number(id)
  if (!Number.isInteger(commentId) || commentId <= 0) return errorJson('评论 id 不合法', 400)

  let body: { status?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return errorJson('请求体必须是 JSON', 400)
  }

  const status = body.status
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return errorJson('未知的评论状态', 400)
  }

  try {
    await setCommentStatus(commentId, status as (typeof STATUSES)[number])
    return json({ ok: true, id: commentId, status })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, true)
  if (!guard.ok) return guard.response

  const { id } = await params
  const commentId = Number(id)
  if (!Number.isInteger(commentId) || commentId <= 0) return errorJson('评论 id 不合法', 400)

  try {
    await removeComment(commentId)
    return json({ ok: true, id: commentId })
  } catch (error) {
    return toErrorResponse(error)
  }
}
