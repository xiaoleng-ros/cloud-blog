import { NextResponse } from 'next/server'

/**
 * 后台「更新日志」页的数据聚合接口（同域，避免浏览器直连 GitHub）。
 *
 * 为什么要中转：后台在国内访问，浏览器直接打 api.github.com 经常超时/被重置；
 * 而 EdgeOne 的函数在海外节点，出去稳定。前端只请求本域名，稳定性高得多。
 *
 * 范围：**只看本项目仓库 cloud-blog**，不掺其它仓库。
 * 提交按目录拆分（GitHub REST 的 `?path=` 过滤）：
 *   - 前台：apps/blog（Astro 站点）
 *   - 后台：apps/cms（Payload CMS + Next 一体化应用）
 * 根目录/共享代码的提交不计入任何一组，避免同一条提交在两边重复出现。
 *
 * 条数：**该目录下的全部提交**（不再固定 10 条）。GitHub 单页上限 100，
 * 这里按页循环直到某页不足 100 条（= 到底），最多 5 页 / 500 条兜底，
 * 避免异常长仓触发未认证的 60 次/小时限流。前端在卡片内部滚动展示全部。
 *
 * 数据源：
 *   - 提交列表：`/repos/{owner}/{repo}/commits?path=<dir>&per_page=100&page=N`（无需 token）
 *   - 贡献热力图：首选 GitHub 官方贡献日历页 `github.com/users/{user}/contributions`（HTML），
 *     解析其中的 data-date / data-level / tool-tip。它与 api.github.com 同属 github.com 域名，
 *     在 EdgeOne 函数节点上出网稳定；备用源才是社区维护的 jogruber API。
 *     ⚠️ 曾经只用 jogruber，线上一直返回 contributions:null —— 该第三方域名在
 *     云函数出口不可达（本地直连正常，极易误判成"接口挂了"），故降级为兜底。
 *
 * 缓存：进程内 5 分钟（同一个函数实例内复用），避免反复打 GitHub 的 60 次/小时限流。
 * 容错：任一上游失败都只降级对应区块（groups[].error / contributions:null），不整体 500。
 */

const GITHUB_USER = 'xiaoleng-ros'
/** 本项目仓库：固定单一仓库，提交按下面的目录拆成前台/后台两组 */
const REPO = 'cloud-blog'
const GROUPS = [
  { key: 'blog', label: '前台', hint: 'apps/blog · Astro 站点', path: 'apps/blog' },
  { key: 'cms', label: '后台', hint: 'apps/cms · Payload 后台', path: 'apps/cms' },
] as const
/** GitHub REST 单页上限 */
const PER_PAGE = 100
/**
 * 每组的安全上限：正常仓库远到不了，纯粹兜底。
 * 未认证限流 60 次/小时，配合 5 分钟缓存，2 组 × 最多 5 页仍在安全区。
 */
const MAX_COMMITS_PER_GROUP = 500
const CACHE_TTL_MS = 5 * 60 * 1000

type RepoCommit = { sha: string; date: string; message: string; url: string }
type GroupResult = {
  key: string
  label: string
  hint: string
  path: string
  commits: RepoCommit[]
  /** 该目录下的提交总数（= commits.length，除非触到 MAX_COMMITS_PER_GROUP 被截断） */
  total: number
  /** 是否因安全上限被截断 */
  truncated?: boolean
  error?: string
}
type ContributionDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }

type Payload = {
  user: string
  repo: string
  year: number
  fetchedAt: string
  contributions: { total: number; days: ContributionDay[] } | null
  groups: GroupResult[]
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

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = 12000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'cloud-blog-cms', ...headers },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 主数据源：GitHub 官方贡献日历页（HTML）。
 *
 * 为什么用它：GitHub 没有提供公开的 contributions REST 接口（GraphQL 需要 token），
 * 但个人页上的贡献日历 HTML 是公开可抓的。它与 api.github.com 同域，
 * 在云函数出口的可达性远好于第三方镜像站点。
 *
 * 结构（每个格子一个 <td>）：
 *   <td data-date="2026-01-04" data-level="0" ...>
 *     <tool-tip ...>2 contributions on May 3rd.</tool-tip>
 * 计数只能从 tool-tip 文本里取（"No contributions on ..." 表示 0）。
 * 按 <td 切块解析比全局正则配对更稳，能保证 date/level/count 属于同一格子。
 */
async function loadContributionsFromGitHub(year: number): Promise<Payload['contributions']> {
  const url =
    `https://github.com/users/${GITHUB_USER}/contributions` +
    `?from=${year}-01-01&to=${year}-12-31`
  const html = await fetchText(url, { accept: 'text/html' }, 20000)
  const chunks = html.split(/<td\b/).slice(1)
  const days: ContributionDay[] = []
  for (const chunk of chunks) {
    const dateMatch = chunk.match(/data-date="(\d{4}-\d{2}-\d{2})"/)
    if (!dateMatch) continue
    const date = dateMatch[1]
    if (!date.startsWith(String(year))) continue
    const levelMatch = chunk.match(/data-level="([0-4])"/)
    let count = 0
    const tipMatch = chunk.match(/<tool-tip[^>]*>([^<]*)<\/tool-tip>/)
    if (tipMatch) {
      const tip = tipMatch[1].trim()
      if (!/^No contributions/i.test(tip)) {
        const num = tip.match(/^(\d+)\s+contribution/i)
        if (num) count = Number(num[1])
      }
    }
    days.push({
      date,
      count,
      level: (levelMatch ? Number(levelMatch[1]) : toLevel(count)) as ContributionDay['level'],
    })
  }
  if (!days.length) return null
  days.sort((a, b) => a.date.localeCompare(b.date))
  return { total: days.reduce((sum, d) => sum + d.count, 0), days }
}

/** 备用源：社区镜像 jogruber（部分云函数出口访问不到，仅作兜底） */
async function loadContributionsFromMirror(year: number): Promise<Payload['contributions']> {
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
}

/**
 * 贡献热力图：先试官方页，失败再试镜像。
 * 两个源都失败才返回 null（前端显示"接口未返回"占位）。
 */
async function loadContributions(year: number): Promise<Payload['contributions']> {
  try {
    const primary = await loadContributionsFromGitHub(year)
    if (primary) return primary
  } catch (err) {
    console.warn('[changelog] GitHub 贡献日历抓取失败，转备用源：', (err as Error).message)
  }
  try {
    return await loadContributionsFromMirror(year)
  } catch (err) {
    console.warn('[changelog] 备用贡献源也失败：', (err as Error).message)
    return null
  }
}

async function loadGroup(group: (typeof GROUPS)[number]): Promise<GroupResult> {
  // path 过滤：只取改到这个目录的提交，于是同一仓库能拆成前台/后台两条线
  const commits: RepoCommit[] = []
  try {
    for (let page = 1; commits.length < MAX_COMMITS_PER_GROUP; page++) {
      const raw = (await fetchJson(
        `https://api.github.com/repos/${GITHUB_USER}/${REPO}/commits?per_page=${PER_PAGE}&page=${page}&path=${encodeURIComponent(group.path)}`,
        { accept: 'application/vnd.github+json' },
      )) as Array<{ sha: string; html_url: string; commit: { message: string; author?: { date?: string } } }>
      const batch = Array.isArray(raw) ? raw : []
      commits.push(
        ...batch.map((c) => ({
          sha: String(c.sha || '').slice(0, 7),
          date: c.commit?.author?.date || '',
          // 只取首行，避免正文撑爆卡片
          message: String(c.commit?.message || '').split('\n')[0].trim(),
          url: c.html_url || '',
        })),
      )
      // 不足一页 = 已经拉到底（GitHub 按时间倒序返回）
      if (batch.length < PER_PAGE) break
    }
    const truncated = commits.length > MAX_COMMITS_PER_GROUP
    const sliced = truncated ? commits.slice(0, MAX_COMMITS_PER_GROUP) : commits
    return { ...group, commits: sliced, total: sliced.length, truncated }
  } catch (err) {
    // 翻页中途失败：已拿到的保留，只标记错误，不整组清空
    return {
      ...group,
      commits,
      total: commits.length,
      error: err instanceof Error ? err.message : '加载失败',
    }
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

  const [contributions, ...groups] = await Promise.all([loadContributions(year), ...GROUPS.map(loadGroup)])
  const data: Payload = { user: GITHUB_USER, repo: REPO, year, fetchedAt: new Date().toISOString(), contributions, groups }
  cache.set(year, { at: Date.now(), data })

  return NextResponse.json(data, { headers: { 'x-changelog-cache': 'miss' } })
}
