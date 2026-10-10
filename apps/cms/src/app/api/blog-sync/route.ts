import { NextResponse } from 'next/server'
import { renderBlocksForPathname } from '../../../lib/blog-render'
import { getSyncProbe } from '../../../lib/blog-sync'

/**
 * 博客前台数据同步 API
 *
/**
 * 两种模式：
 * 1. 版本探测：GET /api/blog-sync?version=1
 *    只返回 { version, ts }，不渲染区块（命中快照缓存时零查库、零渲染）。
 *    前台轮询兜底时先用它判断数据是否变化，变了再拉全量区块。
 * 1b. 分源指纹：GET /api/blog-sync?digest=1
 *    返回 { version, digests: { posts, notes, projects, settings, nav, media }, ts }，
 *    每个值是「条数:最大 updatedAt」。供 Astro loader 用 <1KB 的响应体判断某一路数据
 *    是否需要重拉全量（否则每 3s 都要把全部正文跨公网拖一遍）。
 * 2. 全量区块：GET /api/blog-sync?path=/posts/xxx
 *    返回 { version, title, blocks }，供前台局部替换页面内容。
 *
 * 客户端也通过 SSE（/api/blog-sync/stream）接收 update 事件，收到后拉全量区块。
 * SSE 为主路径（近实时），轮询为兜底（多实例自愈）。
 */
export const dynamic = 'force-dynamic'

/**
 * path 白名单：区块缓存键直接取自 ?path=，任意值都会进 100 条 LRU ——
 * 垃圾 path 能驱逐真实页面缓存并逐个触发全量渲染（DoS 面）。
 * 规则按博客真实路由形态推导（与 blog-render 的区块组装分支一一对应）：
 * 静态页是固定集合；文章/分类/标签末段是动态的（数字 ID / 编码词条），逐文件枚举不现实，用模式匹配。
 */
const STATIC_SYNC_PATHS = new Set([
  '/',
  '/notes/',
  '/archive/',
  '/about/',
  // 标签墙 / 统计页有同步区块（标签计数、概览卡、逐年列表）
  '/tags/',
  '/stats/',
])
const DYNAMIC_SYNC_PATH_PATTERNS = [
  /^\/posts\/[^/]+\/[^/]+\/$/, // 文章详情：/posts/{分类名}/{数字ID}/
  /^\/categories\/[^/]+\/$/,
  /^\/tags\/[^/]+\/$/,
  /^\/archive\/\d+\/$/, // 归档分页：/archive/2/ …
]

function isSyncablePath(rawPath: string): boolean {
  if (!rawPath.startsWith('/') || rawPath.length > 200) return false
  if (rawPath.includes('\0') || rawPath.includes('\\')) return false
  const segments = rawPath.split('/')
  if (segments.some((s) => s === '.' || s === '..')) return false
  // 与 renderBlocksForPathname 的缓存键归一化一致：补尾斜杠再比对
  const path = rawPath.endsWith('/') ? rawPath : `${rawPath}/`
  if (STATIC_SYNC_PATHS.has(path)) return true
  return DYNAMIC_SYNC_PATH_PATTERNS.some((re) => re.test(path))
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)

    // 轻量版本/指纹探测：走独立的探测查询（每源 count + max updatedAt，DB 层过滤 status），
    // 不再复用全量快照 —— 避免快照一过期，3s 一次的探测就把六路全表全正文拖一遍。
    if (url.searchParams.get('version') === '1' || url.searchParams.get('digest') === '1') {
      const probe = await getSyncProbe()
      const wantDigest = url.searchParams.get('digest') === '1'
      return NextResponse.json(
        {
          version: probe.version,
          ts: Date.now(),
          ...(wantDigest ? { digests: probe.digests } : {}),
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }

    const pathname = url.searchParams.get('path') ?? '/'

    // 非白名单 path：返回空区块、绝不进区块缓存（探测 ?version/?digest 分支在上面，语义不变；
    // path 缺省走 '/' 同样不变）
    if (!isSyncablePath(pathname)) {
      const probe = await getSyncProbe()
      return NextResponse.json(
        { version: probe.version, title: null, blocks: {} },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }

    // 渲染当前页面所需的最新区块
    const result = await renderBlocksForPathname(pathname)

    return NextResponse.json(result, {
      headers: {
        // 禁止缓存：确保客户端每次拿到最新数据
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err) {
    // 真实错误只进服务端日志；响应体不回显 String(err)（本接口匿名可访问，
    // 原始错误可能带连接串/SQL/堆栈等内部信息）
    console.error('[blog-sync] render failed:', err)
    return NextResponse.json(
      { version: String(Date.now()), title: null, blocks: {}, error: '同步数据加载失败，请稍后重试' },
      { status: 500 },
    )
  }
}
