import { NextResponse, type NextRequest } from 'next/server'

/**
 * CSP 违规上报收集端点（配合 `Content-Security-Policy-Report-Only`）。
 *
 * 为什么需要这个端点：
 *   本站后台（Payload + vditor + lexical）内联脚本与内联样式极多，直接上强制 CSP
 *   会把后台界面整块打碎（`apps/cms/next.config.mjs` 第 138-139 行的注释记着这个结论）。
 *   所以第一阶段只发 **Report-Only** 头：浏览器照常渲染，同时把「本会被拦掉的请求」
 *   POST 到这里。跑一段时间后，按真实违规清单收紧策略，再切强制模式。
 *   没有收集端点的话，Report-Only 只是往浏览器控制台刷日志，服务端看不到。
 *
 * 数据形态：CSP 上报的 body 是 `{"csp-report": {...}}`，字段含
 *   `document-uri` / `blocked-uri` / `violated-directive` / `effective-directive` / `disposition`。
 *   这里只保留聚合维度（指令 + 被拦 host + 次数），**不落完整 URL**：
 *   document-uri 里可能带查询串，blocked-uri 里可能有内联内容的指纹，都不必要。
 *
 * 存储：模块级 Map（单实例内存），与 sync-cache 同口径——EdgeOne 多实例各算各的，
 * 冷启动会清零。它的用途是「上线后看几天的大致分布」，不是精确审计，够用。
 *
 * 安全：POST 是浏览器自动发的，不做鉴权（否则收不到）；但正因如此，必须
 *   ① 限制 body 大小（只读前 8 KB）② 限制 Map 条目上限 ③ GET 读结果要 token。
 */

/** 单条上报最多读这么多字节，超出的部分丢弃（防止被当成免费存储） */
const MAX_BODY_BYTES = 8 * 1024

/** 聚合表上限。key 是「指令|host」，正常站点在百级，1000 是宽松上限 */
const MAX_KEYS = 1000

/** 汇总统计（挂 globalThis 以免 dev 热更新丢数据，与 sync-cache 同一写法） */
type CspState = {
  total: number
  /** key = `${directive} ${host}` */
  buckets: Map<string, { count: number; lastSeen: number; sample: string }>
  firstSeen: number
}

const globalRef = globalThis as unknown as { __cloudBlogCspState?: CspState }

function state(): CspState {
  if (!globalRef.__cloudBlogCspState) {
    globalRef.__cloudBlogCspState = { total: 0, buckets: new Map(), firstSeen: Date.now() }
  }
  return globalRef.__cloudBlogCspState
}

/**
 * 把 URL 归一到 host（无 host 的取值原样保留）。
 * CSP 里的 `blocked-uri` 有多种特殊值：`inline`、`eval`、`data`、`blob`，
 * 它们没有 host 但恰好是最需要关注的（说明有内联脚本/样式没被 nonce 覆盖）。
 */
function hostOf(raw: string): string {
  if (!raw) return 'unknown'
  if (!/^https?:\/\//i.test(raw)) return raw.slice(0, 40)
  try {
    return new URL(raw).host
  } catch {
    return raw.slice(0, 40)
  }
}

export async function POST(request: NextRequest) {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    // 超限直接丢，不解析（不给自己制造解析大 JSON 的开销）
    return new NextResponse(null, { status: 204 })
  }

  let directive = 'unknown'
  let blocked = 'unknown'
  try {
    const parsed = JSON.parse(text) as { 'csp-report'?: Record<string, unknown> }
    const report = parsed['csp-report']
    if (report) {
      directive = String(report['effective-directive'] ?? report['violated-directive'] ?? 'unknown')
      blocked = String(report['blocked-uri'] ?? 'unknown')
    }
  } catch {
    // 非 JSON 或结构不符：丢弃，但仍返回 204（不要给攻击者任何反馈信号）
    return new NextResponse(null, { status: 204 })
  }

  const s = state()
  s.total += 1
  const key = `${directive} ${hostOf(blocked)}`
  const now = Date.now()
  const existing = s.buckets.get(key)
  if (existing) {
    existing.count += 1
    existing.lastSeen = now
  } else if (s.buckets.size < MAX_KEYS) {
    s.buckets.set(key, { count: 1, lastSeen: now, sample: blocked.slice(0, 120) })
  }
  // 满表后不再新增 key，但 total 继续涨——这样能看出「有新类型但表满了」

  return new NextResponse(null, { status: 204 })
}

/**
 * GET 读取聚合结果，用于上线后观察几天。
 * 门槛与 `/api/health` 同一个套路：配了 `CSP_REPORT_TOKEN` 就必须带头；
 * 生产环境没配 token 一律 404（不暴露端点存在）。
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CSP_REPORT_TOKEN
  if (expected) {
    const provided = request.headers.get('x-csp-token')
    if (provided !== expected) return new NextResponse(null, { status: 404 })
  } else if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }

  const s = state()
  const rows = [...s.buckets.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100)

  return NextResponse.json(
    {
      total: s.total,
      since: new Date(s.firstSeen).toISOString(),
      keys: s.buckets.size,
      truncated: s.buckets.size >= MAX_KEYS,
      top: rows,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
