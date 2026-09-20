import { readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { NextResponse } from 'next/server'
import { renderBlocksForPathname } from '../../lib/blog-render'
import { injectSyncBlocks } from '../../lib/html-inject'

// 每个 HTML 响应都要按最新后台数据渲染区块，必须走运行时（不能在构建期预渲染）
export const dynamic = 'force-dynamic'

/**
 * 目录定位说明（踩过坑，务必看清）：
 * EdgeOne 运行时容器的工作目录（process.cwd()）**不一定等于项目根目录**，
 * 所以不能只靠 `join(process.cwd(), 'public')` 读文件，否则会出现
 * 「静态托管能返回 /__blog/index.html，但路由死活找不到它 → HTML 全站 404」。
 * 这里按候选顺序探测，取第一个真实存在的目录；
 * 同时保留 `CMS_HTML_DIR` / `CMS_PUBLIC_DIR` 环境变量作为应急覆盖（可在控制台直接改，不必重新部署）。
 */
const HTML_DIR_NAME = '__blog'

function firstExistingDir(candidates: Array<string | undefined>): string | null {
  for (const dir of candidates) {
    if (!dir) continue
    try {
      if (existsSync(dir)) return dir
    } catch {
      // 忽略探测异常，继续下一个候选
    }
  }
  return null
}

/** 博客 HTML 外壳目录（放 __blog 里是为了不被静态托管直接命中，从而留出注入机会） */
function resolveHtmlDir(): string | null {
  return firstExistingDir([
    process.env.CMS_HTML_DIR,
    // 常见情况：cwd 就是 apps/cms
    join(process.cwd(), 'public', HTML_DIR_NAME),
    // cwd 是仓库根目录时
    join(process.cwd(), 'apps', 'cms', 'public', HTML_DIR_NAME),
    // 容器把应用放在 /var/task 之类的目录时
    join('/var/task', 'public', HTML_DIR_NAME),
    // 兜底：从 cwd 逐级向上找「哪个目录下的 public/__blog 存在」
    ...walkUpFor(`public/${HTML_DIR_NAME}`),
  ])
}

/** 静态资源根目录（CSS/JS/图片；正常情况下 Next 的静态处理器先命中，这里只是兜底） */
function resolveAssetDir(): string | null {
  return firstExistingDir([
    process.env.CMS_PUBLIC_DIR,
    join(process.cwd(), 'public'),
    join(process.cwd(), 'apps', 'cms', 'public'),
    join('/var/task', 'public'),
    ...walkUpFor('public'),
  ])
}

/** 从 cwd 起逐级向上，收集「cwd/相对路径」候选（覆盖 cwd 位于子目录/被替换的情况） */
function walkUpFor(relative: string): string[] {
  const out: string[] = []
  let dir = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    const parent = resolve(dir, '..')
    if (parent === dir) break
    out.push(join(parent, relative))
    dir = parent
  }
  return out
}

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
 * 在 HTML 外壳目录里定位页面文件
 *   /              → __blog/index.html
 *   /posts         → __blog/posts/index.html
 *   /posts/        → __blog/posts/index.html
 *   /posts/foo     → __blog/posts/foo/index.html
 *   /about         → __blog/about/index.html
 */
function getStaticHtmlPath(pathname: string): string | null {
  const htmlDir = resolveHtmlDir()
  if (!htmlDir) return null

  // 移除开头和结尾的斜杠，拆分路径段
  const segments = pathname.split('/').filter(Boolean)
  const candidates: string[] = []

  if (segments.length === 0) {
    candidates.push(join(htmlDir, 'index.html'))
  } else {
    const basePath = join(htmlDir, ...segments)
    candidates.push(join(basePath, 'index.html'))
    // 也尝试不带 index.html 的情况（如 /posts 对应 __blog/posts.html）
    candidates.push(basePath + '.html')
    if (segments.length === 1) {
      candidates.push(join(htmlDir, segments[0] + '.html'))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
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
  return new Promise((settle) => {
    const timer = setTimeout(() => settle(null), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        settle(value)
      })
      .catch(() => {
        clearTimeout(timer)
        settle(null)
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
    const assetDir = resolveAssetDir()
    if (assetDir) {
      const filePath = join(assetDir, ...pathname.split('/').filter(Boolean))
      if (existsSync(filePath)) {
        const data = readFileSync(filePath)
        return new NextResponse(data, {
          headers: {
            'Content-Type': MIME_TYPES[ext],
            'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
          },
        })
      }
    }
    // 文件不存在时继续尝试 HTML 路径补全（如 /posts/xxx/index.html）
  }

  // 尝试读取对应的静态 HTML 外壳，并注入后台最新数据
  const htmlPath = getStaticHtmlPath(pathname)

  if (htmlPath) {
    const shell = readFileSync(htmlPath, 'utf-8')
    const html = await renderShellWithData(shell, pathname)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // HTML 外壳禁止缓存：数据虽是响应时注入的，但 CDN/浏览器一旦缓存外壳，
        // 后台改动就会延迟可见。
        'Cache-Control': 'no-store',
      },
    })
  }

  // 找不到对应的页面：返回 Astro 生成的 404 页面（没有则退回纯文本）
  const htmlDir = resolveHtmlDir()
  const notFoundPath = htmlDir ? join(htmlDir, '404.html') : null
  if (notFoundPath && existsSync(notFoundPath)) {
    return new NextResponse(readFileSync(notFoundPath, 'utf-8'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  return new NextResponse('Not Found', { status: 404 })
}
