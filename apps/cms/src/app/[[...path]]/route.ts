import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { NextResponse } from 'next/server'
import { renderBlocksForPathname, resolveLegacyPostPath } from '../../lib/blog-render'
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

/**
 * 归一化请求路径，拒绝目录穿越段。
 * catch-all 参数已被解码，`%2e%2e` 会变成 `..` 原样传进来；
 * 若保留这些段，join 后会逃出 public/__blog 读到 payload.db、.env、源码。
 * 站点里没有合法 URL 需要 `.`/`..`，所以直接判定为非法请求。
 * @returns 归一化后的绝对路径；含穿越段时返回 null
 */
function normalizeRequestPath(segments: string[] | undefined): string | null {
  const decoded: string[] = []
  for (const raw of segments ?? []) {
    const value = safeDecode(raw)
    if (value === '..' || value === '.') return null
    if (value.includes('/') || value.includes('\\') || value.includes('\0')) return null
    if (value) decoded.push(value)
  }
  return '/' + decoded.join('/')
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * 把 baseDir + 路径段解析到 baseDir 内，越界则返回 null。
 * normalizeRequestPath 已挡住穿越段，这里再兜一层，保证两个读取分支都收敛在 baseDir 内。
 */
function resolveWithin(baseDir: string, ...segments: string[]): string | null {
  const root = resolve(baseDir)
  const target = resolve(root, ...segments)
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
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

  // 拆分路径段（调用方已归一化并拒绝穿越段，此处段内不含 '/'）
  const segments = pathname.split('/').filter(Boolean)
  const candidates: string[] = []

  if (segments.length === 0) {
    candidates.push('index.html')
  } else {
    candidates.push(join(...segments, 'index.html'))
    // 也尝试不带 index.html 的情况（如 /posts 对应 __blog/posts.html）
    candidates.push(join(...segments) + '.html')
    if (segments.length === 1) {
      candidates.push(segments[0] + '.html')
    }
  }

  for (const relative of candidates) {
    const safe = resolveWithin(htmlDir, ...relative.split(/[\\/]/).filter(Boolean))
    if (safe && existsSync(safe)) return safe
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
 * notFound：数据层不存在该页面（文章/分类/标签/归档页码查无此物）——
 * 模板兜底分支据此改判 404，避免给不存在的页面拿模板拼出「半成品 HTML」。
 */
async function renderShellWithData(
  html: string,
  pathname: string,
): Promise<{ html: string; title: string | null; notFound: boolean }> {
  try {
    const timeout = injectWarmedUp ? WARM_INJECT_TIMEOUT_MS : COLD_INJECT_TIMEOUT_MS
    const result = await withTimeout(renderBlocksForPathname(pathname), timeout)
    if (!result) return { html, title: null, notFound: false }
    injectWarmedUp = true

    const blocks: Record<string, string> = {}
    for (const [id, value] of Object.entries(result.blocks ?? {})) {
      // '' 保留：语义是「清空该区块」（后台字段被清空时前台实时跟着清空）
      if (typeof value === 'string') blocks[id] = value
    }
    if (Object.keys(blocks).length === 0) {
      return { html, title: result.title ?? null, notFound: result.notFound }
    }

    return {
      html: injectSyncBlocks(html, blocks, result.version, result.title).html,
      title: result.title ?? null,
      notFound: result.notFound,
    }
  } catch (err) {
    console.error('[blog-html] 注入后台数据失败，返回静态外壳:', err)
    return { html, title: null, notFound: false }
  }
}

// ---------------------------------------------------------------------------
// 「同形状模板」兜底：外壳缺失的新页面（新文章 / 新分类 / 新标签 / 新归档页）不再 404。
// 取同类页面里已构建的外壳当模板 + 全量块注入；模板里烘着的「另一个页面」的
// canonical / og:url / og:title 会在 rewriteTemplateHead 里一并改写。
// ---------------------------------------------------------------------------

interface ShapeTemplate {
  file: string
  /** 模板自身对应的页面路径（用于改写 head 里烘死的路径），如 /posts/AI纪元/3/ */
  pathname: string
}

const shapeTemplateCache = new Map<string, ShapeTemplate | null>()

/** 磁盘目录名是解码后的原文（astro 按参数原值建目录）；统一收敛成请求路径形态 */
function fileToPathname(htmlDir: string, file: string): string {
  const relative = file.slice(htmlDir.length).replace(/\\/g, '/').replace(/\/index\.html$/, '')
  const segments = relative
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecode(segment))
  return `/${segments.join('/')}/`
}

function cachedShapeTemplate(key: string, build: () => ShapeTemplate | null): ShapeTemplate | null {
  const cached = shapeTemplateCache.get(key)
  // 命中且模板文件仍在 → 直接用；重出外壳后旧模板被删会自动重扫
  if (cached !== undefined && (!cached || existsSync(cached.file))) return cached
  const fresh = build()
  shapeTemplateCache.set(key, fresh)
  return fresh
}

function findTermShapeTemplate(htmlDir: string, kind: 'categories' | 'tags'): ShapeTemplate | null {
  try {
    const kindDir = join(htmlDir, kind)
    for (const entry of readdirSync(kindDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(kindDir, entry.name, 'index.html')
      if (existsSync(file)) return { file, pathname: fileToPathname(htmlDir, file) }
    }
  } catch {
    // 目录不存在等情况按「没有模板」处理
  }
  return null
}

function findPostShapeTemplate(htmlDir: string): ShapeTemplate | null {
  const postsDir = join(htmlDir, 'posts')
  const candidates: string[] = []
  try {
    for (const cat of readdirSync(postsDir, { withFileTypes: true })) {
      if (!cat.isDirectory()) continue
      // 只收两级（/posts/{分类}/{id}/index.html）；一级的 /posts/{id}/ 是旧地址外壳（noindex），不能当模板
      for (const entry of readdirSync(join(postsDir, cat.name), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const file = join(postsDir, cat.name, entry.name, 'index.html')
        if (existsSync(file)) candidates.push(file)
      }
    }
  } catch {
    return null
  }
  // 优先挑「无目录侧栏（TOC）」的文章外壳：封面位置与 article--toc 栅格都随 TOC 有无而变，
  // 无 TOC 模板能覆盖多数形态（新文章带 TOC 时会缺侧栏，属可接受降级，重出外壳即恢复）
  const chosen =
    candidates.find((file) => {
      try {
        return !readFileSync(file, 'utf-8').includes('data-sync-block="tocSidebar"')
      } catch {
        return false
      }
    }) ??
    candidates[0] ??
    null
  return chosen ? { file: chosen, pathname: fileToPathname(htmlDir, chosen) } : null
}

/** 按请求路径的形状找兜底模板；不是可兜底的动态形态时返回 null（照常 404） */
function findShapeTemplate(pathname: string): ShapeTemplate | null {
  const htmlDir = resolveHtmlDir()
  if (!htmlDir) return null
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'posts' && segments.length >= 3) {
    return cachedShapeTemplate('post', () => findPostShapeTemplate(htmlDir))
  }
  if (segments[0] === 'categories' && segments.length === 2) {
    return cachedShapeTemplate('categories', () => findTermShapeTemplate(htmlDir, 'categories'))
  }
  if (segments[0] === 'tags' && segments.length === 2) {
    return cachedShapeTemplate('tags', () => findTermShapeTemplate(htmlDir, 'tags'))
  }
  if (segments[0] === 'archive' && segments.length === 2 && /^\d+$/.test(segments[1])) {
    return cachedShapeTemplate('archive', () => {
      const file = join(htmlDir, 'archive', 'index.html')
      return existsSync(file) ? { file, pathname: '/archive/' } : null
    })
  }
  return null
}

/** 与 astro 构建产物同口径的逐段编码（getPostPath 对每段做 encodeURIComponent） */
function encodePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : segment))
    .join('/')
}

/**
 * 兜底模板里烘着「另一个页面」的路径与标题，把 head 里随页面变的两处改掉。
 * 只做定向替换（canonical / og:url 的 URL 结尾 + og:title / twitter:title），
 * 不能对全文做路径替换——/archive/ 这类前后缀形态会波及正文里的分页链接。
 */
function rewriteTemplateHead(
  html: string,
  templatePathname: string,
  pathname: string,
  title: string | null,
): string {
  let out = html
  const from = encodePathname(templatePathname)
  // 路由的 pathname 没有尾斜杠，模板路径与构建产物都带——补上再编码，避免改写后的
  // canonical/og:url 丢掉尾斜杠（与站内链接形态不一致）
  const to = encodePathname(pathname.endsWith('/') ? pathname : `${pathname}/`)
  const swapPath = (url: string) => (from && url.endsWith(from) ? url.slice(0, -from.length) + to : url)
  out = out.replace(
    /(<link rel="canonical" href=")([^"]*)(")/,
    (_match, head: string, url: string, tail: string) => `${head}${swapPath(url)}${tail}`,
  )
  out = out.replace(
    /(<meta property="og:url" content=")([^"]*)(")/,
    (_match, head: string, url: string, tail: string) => `${head}${swapPath(url)}${tail}`,
  )
  if (title) {
    const escaped = title
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
    out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escaped}$2`)
    out = out.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escaped}$2`)
  }
  return out
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params
  const pathname = normalizeRequestPath(path)
  if (pathname === null) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // 历史链接 /posts/{id}/ → 301 到现行的 /posts/{分类名}/{id}/。
  // 旧链接在静态产物里也是一份完整页面（Astro 静态输出不执行 getStaticPaths 的 redirect），
  // 所以真 301 只能在「实际返回 HTML 的这一层」做；解析失败就照常返回静态外壳，不影响可访问性。
  try {
    const canonical = await resolveLegacyPostPath(pathname)
    if (canonical) {
      return new NextResponse(null, {
        status: 301,
        headers: { Location: canonical, 'Cache-Control': 'public, max-age=86400' },
      })
    }
  } catch (err) {
    console.error('[blog-html] 旧链接规范化失败，按原路径继续:', err)
  }

  // 有扩展名的路径按静态文件处理：直接从 public 读取并返回
  // 注意：不能使用 NextResponse.next()（app route handler 不支持），必须返回实际内容
  const ext = extname(pathname).toLowerCase()
  if (ext && MIME_TYPES[ext] && ext !== '.html') {
    const assetDir = resolveAssetDir()
    if (assetDir) {
      const filePath = resolveWithin(assetDir, ...pathname.split('/').filter(Boolean))
      if (filePath && existsSync(filePath)) {
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
    const { html } = await renderShellWithData(shell, pathname)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // HTML 外壳禁止缓存：数据虽是响应时注入的，但 CDN/浏览器一旦缓存外壳，
        // 后台改动就会延迟可见。
        'Cache-Control': 'no-store',
      },
    })
  }

  // 外壳缺失：按页面形状取同类模板兜底（新文章 / 新分类 / 新标签 / 新归档页不再 404）
  const shape = findShapeTemplate(pathname)
  if (shape) {
    try {
      const shell = readFileSync(shape.file, 'utf-8')
      const injected = await renderShellWithData(shell, pathname)
      // 数据层不存在该页面（已删除的旧 ID / 不存在的词条 / 超范围页码）：落下走 404，
      // 别拿模板拼出半成品页面
      if (!injected.notFound) {
        const html = rewriteTemplateHead(injected.html, shape.pathname, pathname, injected.title)
        return new NextResponse(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      }
    } catch (err) {
      console.error('[blog-html] 模板兜底失败，走 404:', err)
    }
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
