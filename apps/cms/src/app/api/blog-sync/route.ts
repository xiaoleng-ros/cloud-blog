import { NextResponse } from 'next/server'
import { renderBlocksForPathname } from '../../../lib/blog-render'
import { getSyncData } from '../../../lib/blog-sync'

/**
 * 博客前台数据同步 API
 *
 * 两种模式：
 * 1. 版本探测：GET /api/blog-sync?version=1
 *    只返回 { version, ts }，不渲染区块（命中快照缓存时零查库、零渲染）。
 *    前台轮询兜底时先用它判断数据是否变化，变了再拉全量区块。
 * 2. 全量区块：GET /api/blog-sync?path=/posts/xxx
 *    返回 { version, title, blocks }，供前台局部替换页面内容。
 *
 * 客户端也通过 SSE（/api/blog-sync/stream）接收 update 事件，收到后拉全量区块。
 * SSE 为主路径（近实时），轮询为兜底（多实例自愈）。
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)

    // 轻量版本探测：只返回版本号，不渲染区块
    if (url.searchParams.get('version') === '1') {
      const snapshot = await getSyncData()
      return NextResponse.json(
        { version: snapshot.version, ts: Date.now() },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }

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
