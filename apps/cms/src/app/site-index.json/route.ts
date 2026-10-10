import { NextResponse } from 'next/server'
import { buildSiteIndex } from '../../lib/blog-render'
import { getSyncData } from '../../lib/blog-sync'

// 搜索索引必须响应时生成：新发文章 / 改标题后，9527（及线上同构部署）的站内搜索要立即能搜到，
// 不再依赖「重出静态外壳」。索引口径与 apps/blog 的 site-index.json 端点逐条一致（见 buildSiteIndex）。
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const snapshot = await getSyncData()
    const entries = buildSiteIndex({
      posts: snapshot.posts,
      notes: snapshot.notes,
      projects: snapshot.projects,
      nav: snapshot.nav,
    })
    return NextResponse.json(entries, {
      headers: {
        // 与其它同步接口同一策略：禁止任何缓存，保证搜索永远拿最新
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err) {
    // 真实错误只进服务端日志（匿名可访问的接口不回显内部信息）
    console.error('[site-index] 生成失败:', err)
    return NextResponse.json([], { status: 500 })
  }
}
