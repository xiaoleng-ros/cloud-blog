import { NextResponse } from 'next/server'

/**
 * 后台「更新日志」页的数据聚合接口（同域，避免浏览器直连 GitHub）。
 *
 * 为什么要中转：后台在国内访问，浏览器直接打 api.github.com 经常超时/被重置；
 * 而 EdgeOne 的函数在海外节点，出去稳定。前端只请求本域名，稳定性高得多。
 *
 * 数据源：
 *   - 提交列表：GitHub REST `/repos/{owner}/{repo}/commits?per_page=10`（无需 token）
 *   - 贡献热力图：GitHub 没有公开的 REST 接口，用社区维护的 jogruber contributions API
 *
 * 缓存：进程内 5 分钟（同一个函数实例内复用），避免反复打 GitHub 的 60 次/小时限流。
 * 容错：任一上游失败都只降级对应区块（repos[].error / contributions:null），不整体 500。
 */

const GITHUB_USER = 'xiaoleng-ros'
/** 展示的三个仓库：按「最近有更新」挑的，改这里即可调整卡片 */
const REPOS = [
  { name: 'cloud-blog', label: '云岫博客', hint: 'Blog' },
  { name: 'KeNan', label: '柯南的世界', hint: 'KeNan' },
  { name: 'Travel', label: '人间快照', hint: 'Travel' },
]
const COMMITS_PER_REPO = 10
const CACHE_TTL_MS = 5 * 60 * 1000

type RepoCommit = { sha: string; date: string; message: string; url: string }
type RepoResult = { name: string; label: string; hint: string; commits: RepoCommit[]; error?: string }
type ContributionDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }

type Payload = {
  user: string
  year: number
  fetchedAt: string
  contributions: { total: number; days: ContributionDay[] } | null
  repos: RepoResult[]
}

/** 进程内缓存：key = year */
const cache = new Map<number, { at: number; data: Payload }>()

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'cloud-blog-cms', accept: 'application/json', ...headers },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

/** 贡献量 → 0~4 级（阈值参考 GitHub 自己的分档手感） */
function toLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

async function loadContributions(year: number): Promise<Payload['contributions']> {
  try {
    const raw = (await fetchJson(
      `https://github-contributions-api.jogruber.de/v4/${GITHUB_USER}?y=${year}`,
    )) as { contributions?: Array<{ date: string; count: number }> }
    const list = Array.isArray(raw.contributions) ? raw.contributions : []
    if (!list.length) return null
    const days: ContributionDay[] = list
      .filter((d) => typeof d.date === 'string' && d.date.startsWith(String(year)))
      .map((d) => ({ date: d.date, count: Number(d.count) || 0, level: toLevel(Number(d.count) || 0) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!days.length) return null
    return { total: days.reduce((sum, d) => sum + d.count, 0), days }
  } catch {
    return null
  }
}

async function loadRepo(repo: (typeof REPOS)[number]): Promise<RepoResult> {
  try {
    const raw = (await fetchJson(
      `https://api.github.com/repos/${GITHUB_USER}/${repo.name}/commits?per_page=${COMMITS_PER_REPO}`,
      { accept: 'application/vnd.github+json' },
    )) as Array<{ sha: string; html_url: string; commit: { message: string; author?: { date?: string } } }>
    const commits = (Array.isArray(raw) ? raw : []).map((c) => ({
      sha: String(c.sha || '').slice(0, 7),
      date: c.commit?.author?.date || '',
      // 只取首行，避免正文撑爆卡片
      message: String(c.commit?.message || '').split('\n')[0].trim(),
      url: c.html_url || '',
    }))
    return { ...repo, commits }
  } catch (err) {
    return { ...repo, commits: [], error: err instanceof Error ? err.message : '加载失败' }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const now = new Date()
  const yearParam = Number(searchParams.get('year'))
  const year = Number.isInteger(yearParam) && yearParam >= 2008 && yearParam <= now.getFullYear()
    ? yearParam
    : now.getFullYear()

  const hit = cache.get(year)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { 'x-changelog-cache': 'hit' } })
  }

  const [contributions, ...repos] = await Promise.all([loadContributions(year), ...REPOS.map(loadRepo)])
  const data: Payload = { user: GITHUB_USER, year, fetchedAt: new Date().toISOString(), contributions, repos }
  cache.set(year, { at: Date.now(), data })

  return NextResponse.json(data, { headers: { 'x-changelog-cache': 'miss' } })
}
