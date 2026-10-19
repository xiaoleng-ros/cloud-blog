import { errorJson, json, requireAdmin, toErrorResponse } from '../../../../../lib/comments-admin-guard'
import { replyToComment } from '../../../../../lib/waline-admin'

/**
 * 后台以站长身份回复一条评论。
 *
 * POST /api/comments/:id/reply  body: { content: string, url: string }
 *
 * `url` 由前端从列表数据里**原样带回**父评论的 url。Waline 用 url 把评论挂到文章上，
 * 自己拼路径很容易和库里存的形态（完整地址 or 裸路径）对不上，
 * 结果就是回复挂在一座前台永远查不到的空文章下面。
 *
 * 署名取站点设置的「作者」（siteAuthor）：后台那个服务账号在 wl_users 里叫
 * 「CMS 审核服务」、邮箱 cms-moderation@invalid.local，直接拿它发评论读者会看到内部名字。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // write = true：带 cookie 的写操作强制同源校验
  const guard = await requireAdmin(request, true)
  if (!guard.ok) return guard.response

  const { id } = await params
  const commentId = Number(id)
  if (!Number.isInteger(commentId) || commentId <= 0) return errorJson('评论 id 不合法', 400)

  let body: { content?: unknown; url?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return errorJson('请求体必须是 JSON', 400)
  }

  const content = typeof body.content === 'string' ? body.content : ''
  const url = typeof body.url === 'string' ? body.url : ''
  if (!content.trim()) return errorJson('回复内容不能为空', 400)
  if (content.length > 2000) return errorJson('回复内容过长（最多 2000 字）', 400)
  if (!url.trim()) return errorJson('这条评论缺少所属文章地址，无法回复', 400)

  try {
    const settings = await guard.payload.findGlobal({ slug: 'site-settings' })
    const nick = (settings?.siteAuthor ?? '').trim()
    const result = await replyToComment({ parentId: commentId, url, content, nick })
    return json({ ok: true, ...result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
