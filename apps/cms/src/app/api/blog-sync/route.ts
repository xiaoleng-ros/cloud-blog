import { NextResponse } from 'next/server'
import { renderBlocksForPathname } from '../../../lib/blog-render'

/**
 * 博客前台数据同步 API
 *
 * 前台（Astro 静态页面）的客户端脚本每隔几秒请求本接口：
 *   GET /api/blog-sync?path=/posts/xxx
 * 返回内容：
 *   - version：当前数据版本号（posts/notes/site-settings/navigation 的最大 updatedAt）
 *   - title：页面标题（如需更新 <title>）
 *   - blocks：按 data-sync-block 锚点 ID 分组的最新 HTML 区块
 *
 * 客户端对比本地缓存的 version，若变化则用 blocks 局部替换页面内容，
 * 实现「后台改数据 → 前台 3-5 秒自动更新」。
 *
 * 本路由路径精确匹配 /api/blog-sync，优先级高于 [[...path]] 静态 catch-all，
 * 不会被静态文件处理逻辑拦截。
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const pathname = url.searchParams.get('path') ?? '/'

    // 渲染当前页面所需的最新区块
    const result = await renderBlocksForPathname(pathname)

    return NextResponse.json(result, {
      headers: {
        // 禁止缓存：确保客户端每次拿到最新数据
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err) {
    console.error('[blog-sync] render failed:', err)
    return NextResponse.json(
      { version: String(Date.now()), title: null, blocks: {}, error: String(err) },
      { status: 500 },
    )
  }
}
