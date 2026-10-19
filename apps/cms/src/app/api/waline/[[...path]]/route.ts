import { forwardToWaline } from '../../../../lib/waline-bridge'
import { scheduleLazyGc } from '../../../../lib/comment-image-gc'

// Waline 内部是 ThinkJS/Koa + pg 连接，只能在 Node 运行时跑
export const runtime = 'nodejs'
// 评论数据每次都要实时读写，禁止任何静态化/缓存
export const dynamic = 'force-dynamic'

/**
 * 把 `/api/waline/*` 转发进进程内 Waline 服务。
 * 剥掉 Next 挂载前缀 `/api/waline`，还原成 Waline 原生路径（`/api/comment`、`/ui/...` 等）。
 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const stripped = url.pathname.replace(/^\/api\/waline/, '') || '/'
  const response = await forwardToWaline(stripped, url.searchParams.toString(), request)

  // 访客发评论成功 → 顺手触发一次惰性回收（节流 6 小时，排在响应之后，不拖慢评论提交）。
  // 垃圾评论正是这类流量带来的：有新的进来，就顺手把过期的清掉。
  if (request.method === 'POST' && stripped === '/api/comment' && response.ok) {
    scheduleLazyGc()
  }

  return response
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
export const HEAD = handle
