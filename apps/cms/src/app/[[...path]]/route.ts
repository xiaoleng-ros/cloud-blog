import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { NextResponse } from 'next/server'
import { renderBlocksForPathname } from '../../lib/blog-render'
import { injectSyncBlocks } from '../../lib/html-inject'

// 每个 HTML 响应都要按最新后台数据渲染区块，必须走运行时（不能在构建期预渲染）
export const dynamic = 'force-dynamic'

// public 目录：Next / EdgeOne 会自动把这里的文件当静态资源直接返回
const PUBLIC_DIR = join(process.cwd(), 'public')

/**
 * 博客 HTML 外壳目录（public/__blog/…）。
 *
 * 为什么单独放一层而不是直接放 public/：
 * public/index.html 会被静态托管**直接命中**、绕过这个路由，
 * 那样就没机会在响应时注入最新数据，首屏仍会闪现构建时的旧内容。
 * 把 HTML 挪进一个独立子目录后，所有页面请求都会落到这里，
 * 由本路由读取外壳 → 注入后台数据 → 返回（CSS/JS/图片等静态资源仍在 public/ 里走静态托管）。
 */
const HTML_DIR_NAME = '__blog'
const HTML_DIR = join(PUBLIC_DIR, HTML_DIR_NAME)

// 静态文件 Content-Type 映射（EdgeOne 上静态资源请求会进入此路由，需要直接读取返回）
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.html': 'text/html; charset=utf-8',
}

/**
 * 从 HTML 外壳目录读取并返回静态 HTML 文件
 * 支持路径自动补全：
 *   /              → __blog/index.html
 *   /posts         → __blog/posts/index.html
 *   /posts/        → __blog/posts/index.html
 *   /posts/foo     → __blog/posts/foo/index.html
 *   /about         → __blog/about/index.html
 */
function getStaticHtmlPath(pathname: string): string | null {
  // 移除开头和结尾的斜杠，拆分路径段
  const segments = pathname.split('/').filter(Boolean)

  // 尝试路径补全规则
  const candidates: string[] = []

  if (segments.length === 0) {
    // 根路径 /
    candidates.push(join(HTML_DIR, 'index.html'))
  } else {
    // 子路径 /posts/foo
    const basePath = join(HTML_DIR, ...segments)
    candidates.push(join(basePath, 'index.html'))
    // 也尝试不带 index.html 的情况（如 /posts 对应 __blog/posts/index.html）
    candidates.push(basePath + '.html')
    // 尝试 /posts 对应 __blog/posts.html（兼容旧结构）
    if (segments.length === 1) {
      candidates.push(join(HTML_DIR, segments[0] + '.html'))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * 注入等待上限：后台/数据库异常或冷启动太慢时不能一直拖住页面，
 * 超时就先返回静态外壳（前台轮询/SSE 会在浏览器里补上，等同于旧行为）。
 * 冷启动（实例刚起来、Payload 还没初始化完）给更宽的窗口，
 * 一旦成功过一次说明数据层已经热了，后面就收紧到 2.5s 保证响应速度。
 */
const COLD_INJECT_TIMEOUT_MS = 8000
const WARM_INJECT_TIMEOUT_MS = 2500
let injectWarmedUp = false

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(null)
      })
  })
}

/**
 * 用后台最新数据渲染该页面的区块并注入静态外壳。
 * 任何一步失败（后台不可用、渲染异常、超时）都退回原始外壳，保证页面永远能打开。
 */
async function renderShellWithData(html: string, pathname: string): Promise<string> {
  try {
    const timeout = injectWarmedUp ? WARM_INJECT_TIMEOUT_MS : COLD_INJECT_TIMEOUT_MS
    const result = await withTimeout(renderBlocksForPathname(pathname), timeout)
    if (!result) return html
    injectWarmedUp = true

    const blocks: Record<string, string> = {}
    for (const [id, value] of Object.entries(result.blocks ?? {})) {
      if (typeof value === 'string' && value !== '') blocks[id] = value
    }
    if (Object.keys(blocks).length === 0) return html

    return injectSyncBlocks(html, blocks, result.version, result.title).html
  } catch (err) {
    console.error('[blog-html] 注入后台数据失败，返回静态外壳:', err)
    return html
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params
  const pathname = '/' + (path?.join('/') ?? '')

  // 有扩展名的路径按静态文件处理：直接从 public 读取并返回
  // 注意：不能使用 NextResponse.next()（app route handler 不支持），必须返回实际内容
  const ext = extname(pathname).toLowerCase()
  if (ext && MIME_TYPES[ext] && ext !== '.html') {
    const filePath = join(PUBLIC_DIR, ...pathname.split('/').filter(Boolean))
    if (existsSync(filePath)) {
      const data = readFileSync(filePath)
      return new NextResponse(data, {
        headers: {
          'Content-Type': MIME_TYPES[ext],
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        },
      })
    }
    // 文件不存在时继续尝试 HTML 路径补全（如 /posts/xxx/index.html）
  }

  // 尝试读取对应的静态 HTML 外壳，并注入后台最新数据
  const htmlPath = getStaticHtmlPath(pathname)

  if (htmlPath) {
    const shell = readFileSync(htmlPath, 'utf-8')
    // 路径统一成带尾斜杠的形式再交给渲染层，保证与前台轮询共用同一份区块缓存
    const html = await renderShellWithData(shell, pathname)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // HTML 外壳禁止缓存：页面数据虽然是响应时注入的最新数据，
        // 但 CDN/浏览器一旦缓存住外壳，后台改动就会延迟可见。
        'Cache-Control': 'no-store',
      },
    })
  }

  // 找不到对应的页面：返回 Astro 生成的 404 页面（没有则退回纯文本）
  const notFoundPath = join(HTML_DIR, '404.html')
  if (existsSync(notFoundPath)) {
    return new NextResponse(readFileSync(notFoundPath, 'utf-8'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  return new NextResponse('Not Found', { status: 404 })
}
