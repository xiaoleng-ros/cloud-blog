import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { NextResponse } from 'next/server'

// 临时诊断端点：部署后访问 /api/blog-html-debug，直接看运行时能读到哪些目录、
// 以及路由的候选路径命中哪一个。定位完即可删除。
export const dynamic = 'force-dynamic'

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

function probe(dir: string) {
  try {
    if (!existsSync(dir)) return { path: dir, exists: false }
    return { path: dir, exists: true, entries: readdirSync(dir).slice(0, 25) }
  } catch (err) {
    return { path: dir, exists: false, error: String(err) }
  }
}

function probeFile(file: string) {
  try {
    if (!existsSync(file)) return { path: file, exists: false }
    return { path: file, exists: true, size: statSync(file).size }
  } catch (err) {
    return { path: file, exists: false, error: String(err) }
  }
}

export async function GET() {
  const cwd = process.cwd()

  const htmlCandidates = [
    process.env.CMS_HTML_DIR,
    join(cwd, 'public', '__blog'),
    join(cwd, 'apps', 'cms', 'public', '__blog'),
    join('/var/task', 'public', '__blog'),
    ...walkUpFor('public/__blog'),
  ].filter((value): value is string => Boolean(value))

  const found = htmlCandidates.find((dir) => {
    try {
      return existsSync(dir)
    } catch {
      return false
    }
  })

  const indexInFound = found ? probeFile(join(found, 'index.html')) : null
  let peek: string | null = null
  if (indexInFound?.exists) {
    try {
      peek = readFileSync(join(found as string, 'index.html'), 'utf-8').slice(0, 200)
    } catch {
      peek = null
    }
  }

  return NextResponse.json(
    {
      cwd,
      env: {
        CMS_HTML_DIR: process.env.CMS_HTML_DIR ?? null,
        CMS_PUBLIC_DIR: process.env.CMS_PUBLIC_DIR ?? null,
        NODE_ENV: process.env.NODE_ENV ?? null,
        NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL ?? null,
      },
      resolvedHtmlDir: found ?? null,
      indexHtml: indexInFound,
      peek,
      htmlDirCandidates: htmlCandidates.map(probe),
      extra: [
        probe(join(cwd, 'public')),
        probe(join(cwd, '.next')),
        probe('/var/task'),
      ],
      ts: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
