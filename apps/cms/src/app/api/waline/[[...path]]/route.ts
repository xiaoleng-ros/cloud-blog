import { forwardToWaline } from '../../../../lib/waline-bridge'
import { WalineConfigError } from '../../../../lib/waline-env'
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

  let response: Response
  try {
    response = await forwardToWaline(stripped, url.searchParams.toString(), request)
  } catch (err) {
    /*
     * 配置缺失时给出可读的 503，而不是让异常冒到 Next 变成 0 字节空 500。
     *
     * 响应体沿用 Waline 自己的信封形状（errno/errmsg），这样：
     *   - 博客前端的评论组件按 errmsg 直接显示原因，不会渲染出一片空白；
     *   - 后台 describeApiError 对 503 依然给通用文案，但 /api/health 能查到根因。
     * 2026-10-21「评论管理页操作失败」就是空 500 把配置问题藏住了。
     */
    if (err instanceof WalineConfigError) {
      console.error('[waline] 配置错误:', err.message)
      return Response.json(
        { errno: 503, errmsg: err.message },
        { status: err.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw err
  }

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
