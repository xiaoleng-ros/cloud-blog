import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

// public 目录的绝对路径（相对于项目根目录）
const PUBLIC_DIR = join(process.cwd(), 'public')

// 静态文件扩展名（这些直接从 public 提供，不需要处理）
const STATIC_EXTENSIONS = new Set([
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.json', '.xml', '.txt', '.pdf',
  '.webmanifest',
])

/**
 * 从 public 目录读取并返回静态 HTML 文件
 * 支持路径自动补全：
 *   /              → public/index.html
 *   /posts         → public/posts/index.html
 *   /posts/        → public/posts/index.html
 *   /posts/foo     → public/posts/foo/index.html
 *   /about         → public/about/index.html
 */
function getStaticHtmlPath(pathname: string): string | null {
  // 移除开头和结尾的斜杠，拆分路径段
  const segments = pathname.split('/').filter(Boolean)

  // 尝试路径补全规则
  const candidates: string[] = []

  if (segments.length === 0) {
    // 根路径 /
    candidates.push(join(PUBLIC_DIR, 'index.html'))
  } else {
    // 子路径 /posts/foo
    const basePath = join(PUBLIC_DIR, ...segments)
    candidates.push(join(basePath, 'index.html'))
    // 也尝试不带 index.html 的情况（如 /posts 对应 public/posts/index.html）
    candidates.push(basePath + '.html')
    // 尝试 /posts 对应 public/posts.html（兼容旧结构）
    if (segments.length === 1) {
      candidates.push(join(PUBLIC_DIR, segments[0] + '.html'))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params
  const pathname = '/' + (path?.join('/') ?? '')

  // 跳过 Payload 后台和管理 API 路由，由对应的具体路由处理器处理
  if (pathname.startsWith('/admin') || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // 检查是否是静态资源（有扩展名），如果是，让 Next.js 直接从 public 提供
  const ext = pathname.slice(pathname.lastIndexOf('.'))
  if (STATIC_EXTENSIONS.has(ext)) {
    // 让 Next.js 直接从 public 目录提供静态资源
    return NextResponse.next()
  }

  // 尝试读取对应的静态 HTML 文件
  const htmlPath = getStaticHtmlPath(pathname)

  if (htmlPath) {
    const html = readFileSync(htmlPath, 'utf-8')
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  }

  // 找不到对应的静态文件，返回 404
  return new NextResponse('Not Found', { status: 404 })
}
