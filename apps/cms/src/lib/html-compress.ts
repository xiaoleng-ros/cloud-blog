import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { NextResponse } from 'next/server'

/**
 * HTML 响应的传输压缩（brotli）。
 *
 * 为什么必须自己压：EdgeOne 只对「静态层直接命中的文件」自动 br/gzip，
 * 由 Node 函数产生的响应一律裸传（实测首页 145,758 B 无 content-encoding）。
 * 本项目所有 HTML 都要经过运行时注入后台数据，属于函数响应，因此平台不会代劳。
 *
 * ## 为什么不按 Accept-Encoding 协商（重要）
 *
 * 平台在把请求交给函数之前，会把 `accept-encoding` 改写成恒为 `identity`
 * （实测函数侧读到的就是 identity，无论浏览器真实能力如何）。所以「按客户端
 * 能力决定是否压缩」在函数侧根本无法实现。
 *
 * 但平台在返回路径上有另一套逻辑，实测（2026-10-31，debug 接口）：
 *   - 函数返回「不声明 Content-Encoding 的大文本」→ 平台原样透传，不压缩；
 *   - 函数返回「声明了 Content-Encoding 的响应」→ 平台先解开，再按客户端的
 *     **真实** accept-encoding 重新编码。
 *     实测 216 KB 文本：客户端要 br → 47 B(ce=br)；只要 gzip → 595 B(ce=gzip)；
 *     客户端发 identity → 平台解开后回 216 KB 明文。
 *
 * 因此这里的策略是：**无条件以 br 返回**，由平台负责按真实客户端能力重编码
 * （不支持 br 的客户端拿到 gzip 或明文，都不会收到无法解码的字节）。
 * 这样既绕过了 accept-encoding 被改写的问题，也不必自己维护 gzip 分支。
 *
 * 为什么带缓存：同一路径在快照周期（5s）内会被反复请求，每次重压要多花约 3 ms CPU；
 * 按 `pathname + 数据版本` 缓存压好的 Buffer，命中率极高。
 * 版本取了数据摘要，后台一改动版本号就变，旧条目自然失效（并有长度兜底校验）。
 */

/** 小于这个字节数不值得压（压缩头开销可能比收益还大） */
const MIN_COMPRESS_BYTES = 1024

/** 缓存条目上限：每条约 40 KB(br) + 45 KB(gzip)，50 条最坏约 4 MB */
const MAX_CACHE_ENTRIES = 50

const BROTLI_OPTIONS = {
  params: {
    // q5：实测 145 KB HTML → 40.5 KB / 3.2 ms；q11 体积只再小一点但慢一个数量级
    [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  },
}

type CacheEntry = {
  /** 原始 HTML 的 UTF-8 字节数，用作命中校验（防止同键不同体） */
  sourceBytes: number
  br?: Buffer
}

/** key → 压缩结果。Map 的插入顺序即 LRU 顺序（命中时删除重插）。 */
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function cacheSet(key: string, entry: CacheEntry): void {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** 解析 Accept-Encoding，返回 token → q 值 */
function parseAcceptEncoding(header: string | null): Map<string, number> {
  const weights = new Map<string, number>()
  if (!header) return weights
  for (const part of header.split(',')) {
    const segments = part.split(';')
    const token = (segments[0] ?? '').trim().toLowerCase()
    if (!token) continue
    let q = 1
    for (const param of segments.slice(1)) {
      const [rawName, rawValue] = param.split('=')
      if ((rawName ?? '').trim().toLowerCase() !== 'q') continue
      const parsed = Number.parseFloat((rawValue ?? '').trim())
      if (Number.isFinite(parsed)) q = parsed
    }
    weights.set(token, q)
  }
  return weights
}

/**
 * 判断客户端是否**明确拒绝** br（`br;q=0`）。
 *
 * 注意这里刻意不判断「客户端是否声明支持 br」：平台喂给函数的 accept-encoding
 * 恒为 identity，按它判断会永远拿不到 br。只有在客户端显式写了 q=0 时才降级，
 * 其余一律发 br 交给平台重编码（见文件头注释里的实测矩阵）。
 */
export function clientRejectsBrotli(header: string | null): boolean {
  const explicit = parseAcceptEncoding(header).get('br')
  return explicit === 0
}

/** 取压缩结果（带 LRU 缓存）。返回 null 表示不值得压，调用方原样发送。 */
function compress(
  html: string,
  cacheKey: string | undefined,
): { body: Buffer; sourceBytes: number } | null {
  const sourceBytes = Buffer.byteLength(html, 'utf8')
  if (sourceBytes < MIN_COMPRESS_BYTES) return null

  if (cacheKey) {
    const hit = cacheGet(cacheKey)
    if (hit && hit.sourceBytes === sourceBytes && hit.br) {
      return { body: hit.br, sourceBytes }
    }
  }

  const body = brotliCompressSync(html, BROTLI_OPTIONS)

  if (cacheKey) {
    const existing = cacheGet(cacheKey)
    // 键相同但源长度变了（版本没变而外壳被换掉）：丢弃旧条目重新攒
    const entry: CacheEntry =
      existing && existing.sourceBytes === sourceBytes ? existing : { sourceBytes }
    entry.br = body
    cacheSet(cacheKey, entry)
  }

  return { body, sourceBytes }
}

/**
 * 构造已压缩的 HTML 响应。
 *
 * 三个 HTML 分支（正常注入 / 同形状模板兜底 / 404）共用，
 * 头部口径必须一致：`no-store` 保持（CDN 缓存外壳会让后台改动延迟可见）。
 *
 * 输出恒为 br；由 EdgeOne 按其可见的真实客户端能力决定最终编码
 * （不支持 br 时平台会自己转成 gzip 或明文，调用方无需关心）。
 */
export function createHtmlResponse(
  html: string,
  request: Request,
  options: { status?: number; cacheKey?: string } = {},
): NextResponse {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // 同一 URL 会按编码返回不同字节，缓存必须按 Accept-Encoding 分桶
    Vary: 'Accept-Encoding',
  })

  const compressed = clientRejectsBrotli(request.headers.get('accept-encoding'))
    ? null
    : compress(html, options.cacheKey)

  if (!compressed) {
    return new NextResponse(html, { status: options.status ?? 200, headers })
  }

  headers.set('Content-Encoding', 'br')
  // 显式给长度：压缩后是定长 Buffer，省掉 chunked 编码。
  // 平台若重新编码会覆盖成它自己的长度，不会冲突。
  headers.set('Content-Length', String(compressed.body.length))
  return new NextResponse(new Uint8Array(compressed.body), {
    status: options.status ?? 200,
    headers,
  })
}
