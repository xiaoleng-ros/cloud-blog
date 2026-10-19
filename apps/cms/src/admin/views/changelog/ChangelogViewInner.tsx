'use client'

/**
 * 更新日志页（/admin/changelog）
 *
 * 版式对齐参考图：页头（标题 + 年份选择）→ GitHub 贡献热力图卡片 →
 * 「仓库提交记录」分隔标题 → 前台 / 后台两张卡片（虚线时间线 + 圆点 + 时间 + 提交信息）。
 *
 * 提交条数：两张卡片展示的是该目录下的**全部**提交（不再固定 10 条 / 不再分页按钮），
 * 页面整体不滚，滚动只发生在卡片内部的时间线上（见 admin-theme.css 的 .changelog / .changelog__repos）。
 *
 * 数据获取顺序（照需求约定）：
 *   loadData() 先查 sessionStorage 缓存
 *     ├─ 有缓存且未过期 → 直接渲染，不发请求
 *     └─ 没有缓存 → fetch('/api/changelog?year=…')
 *   拿到后 map 成 { label: 'MM-DD HH:mm', children: commit.message }，
 *   写回 sessionStorage + setState。
 *
 * 为什么不是浏览器直连 GitHub：国内直连 api.github.com 经常超时/被重置，
 * 改由同域 /api/changelog 在服务端聚合（详见该路由顶部注释）。
 * 缓存分两层：sessionStorage（浏览器，5 分钟）+ 服务端进程内（5 分钟）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'

type ContributionDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }
type RepoCommit = { sha: string; date: string; message: string; url: string }
type GroupResult = {
  key: string
  label: string
  hint: string
  path: string
  commits: RepoCommit[]
  /** 该目录下的提交总数（触到安全上限时小于实际值） */
  total?: number
  truncated?: boolean
  error?: string
}
type ChangelogData = {
  user: string
  repo: string
  year: number
  fetchedAt: string
  contributions: { total: number; days: ContributionDay[] } | null
  groups: GroupResult[]
}

const CACHE_PREFIX = 'wb-changelog:v2'
const CACHE_TTL_MS = 5 * 60 * 1000
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const cacheKey = (year: number) => `${CACHE_PREFIX}:${year}`

function readCache(year: number): ChangelogData | null {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(year))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: ChangelogData }
    if (!parsed?.data || Date.now() - parsed.at > CACHE_TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(year: number, data: ChangelogData) {
  try {
    window.sessionStorage.setItem(cacheKey(year), JSON.stringify({ at: Date.now(), data }))
  } catch {
    // 隐私模式 / 配额满：缓存失败不影响主流程
  }
}

/** ISO 时间 → 本地 'MM-DD HH:mm'（时间线左侧标签） */
function formatLabel(iso: string): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type WeekColumn = { days: Array<ContributionDay | null>; monthLabel?: string }

/**
 * 把「日」列表排成 GitHub 那种按周分列的网格：每列一周，行从周日到周六。
 * 首尾不足一周的位置补 null（渲染成透明空格），避免第一列错位。
 */
function buildWeeks(days: ContributionDay[]): WeekColumn[] {
  if (!days.length) return []
  const byDate = new Map(days.map((d) => [d.date, d]))

  const first = new Date(`${days[0].date}T00:00:00`)
  const last = new Date(`${days[days.length - 1].date}T00:00:00`)
  const cursor = new Date(first)
  cursor.setDate(cursor.getDate() - cursor.getDay()) // 回到本周周日

  const weeks: WeekColumn[] = []
  let lastLabeledMonth = -1

  while (cursor <= last) {
    const week: Array<ContributionDay | null> = []
    let weekMonth = -1
    for (let i = 0; i < 7; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const hit = byDate.get(key)
      if (hit && weekMonth === -1) weekMonth = cursor.getMonth()
      week.push(hit ?? null)
      cursor.setDate(cursor.getDate() + 1)
    }
    // 月份标签间隔至少 3 列，避免文字互相压住
    let lastLabeledIdx = -1
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].monthLabel) {
        lastLabeledIdx = i
        break
      }
    }
    const monthLabel =
      weekMonth !== -1 && weekMonth !== lastLabeledMonth && weeks.length - lastLabeledIdx >= 3
        ? MONTH_LABELS[weekMonth]
        : undefined
    if (monthLabel) lastLabeledMonth = weekMonth
    weeks.push({ days: week, monthLabel })
  }
  return weeks
}

const GROUP_TINT = ['green', 'violet'] as const

export function ChangelogViewInner() {
  const nowYear = new Date().getFullYear()
  const [year, setYear] = useState(nowYear)
  const [data, setData] = useState<ChangelogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [yearOpen, setYearOpen] = useState(false)
  const yearRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(
    async (targetYear: number, force = false) => {
      // 先查缓存：命中则直接渲染，不发请求
      if (!force) {
        const cached = readCache(targetYear)
        if (cached) {
          setData(cached)
          setError(null)
          setLoading(false)
          return
        }
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/changelog?year=${targetYear}`, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ChangelogData
        // map 成时间线需要的形态：{ label: 'MM-DD HH:mm', children: message }
        const normalized: ChangelogData = {
          ...json,
          groups: (json.groups || []).map((group) => ({
            ...group,
            commits: (group.commits || []).map((c) => ({ ...c, date: c.date })),
          })),
        }
        writeCache(targetYear, normalized)
        setData(normalized)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadData(year)
  }, [year, loadData])

  // 下拉：点外面或按 Esc 收起
  useEffect(() => {
    if (!yearOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (yearRef.current && !yearRef.current.contains(e.target as Node)) setYearOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setYearOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [yearOpen])

  const weeks = useMemo(() => buildWeeks(data?.contributions?.days ?? []), [data])
  const total = data?.contributions?.total ?? 0
  /** 两张卡片（前台 + 后台）合计提交条数，用于分隔标题右侧的提示 */
  const totalCommits = useMemo(
    () => (data?.groups ?? []).reduce((sum, g) => sum + (g.commits?.length ?? 0), 0),
    [data],
  )
  const yearOptions = Array.from({ length: 5 }, (_, i) => nowYear - i)

  return (
    <div className="changelog">
      <PageHeader
        title="更新日志"
        actions={
          <div className="changelog__year" ref={yearRef}>
            <button
              type="button"
              className={`changelog__year-trigger${yearOpen ? ' changelog__year-trigger--open' : ''}`}
              onClick={() => setYearOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={yearOpen}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                <path d="M3.5 9.5h17M8 3v4M16 3v4" />
              </svg>
              <span className="changelog__year-label">年份</span>
              <span className="changelog__year-value">{year}</span>
              <svg className="changelog__year-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9.5l6 6 6-6" />
              </svg>
            </button>

            {yearOpen ? (
              <div className="changelog__year-menu" role="listbox" aria-label="选择年份">
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    type="button"
                    role="option"
                    aria-selected={y === year}
                    className={`changelog__year-option${y === year ? ' changelog__year-option--active' : ''}`}
                    onClick={() => {
                      setYear(y)
                      setYearOpen(false)
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        }
      />

      {/* ── GitHub 贡献热力图 ───────────────────────────────── */}
      <section className="changelog__card changelog__heat-card">
        <header className="changelog__card-head">
          <span className="changelog__brand-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.9-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
            </svg>
          </span>
          <div className="changelog__card-titles">
            <h2 className="changelog__card-title">GitHub 贡献热力图</h2>
            <p className="changelog__card-sub">
              @{data?.user ?? '—'} · {year} 年
            </p>
          </div>
        </header>

        {loading && !data ? (
          <div className="changelog__heat-wrap">
            <div className="changelog__heat-skeleton" aria-label="加载中">
              {Array.from({ length: 53 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
          </div>
        ) : weeks.length ? (
          <div className="changelog__heat-wrap">
            <div className="changelog__heat">
              {weeks.map((week, wi) => (
                <div className="changelog__heat-col" key={wi}>
                  {week.monthLabel ? <span className="changelog__heat-month">{week.monthLabel}</span> : null}
                  <div className="changelog__heat-cells">
                    {week.days.map((day, di) => (
                      <span
                        key={di}
                        className={`changelog__cell changelog__cell--l${day?.level ?? 0}${day ? '' : ' changelog__cell--void'}`}
                        title={day ? `${day.date} · ${day.count} 次贡献` : ''}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <footer className="changelog__heat-foot">
              <span>
                {year} 年共 <strong>{total}</strong> 次贡献
              </span>
              <span className="changelog__legend">
                Less
                <i className="changelog__cell changelog__cell--l0" />
                <i className="changelog__cell changelog__cell--l1" />
                <i className="changelog__cell changelog__cell--l2" />
                <i className="changelog__cell changelog__cell--l3" />
                <i className="changelog__cell changelog__cell--l4" />
                More
              </span>
            </footer>
          </div>
        ) : (
          <div className="changelog__empty changelog__empty--heat">
            <span className="changelog__empty-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <path d="M3.5 9.5h17M8.5 3v3M15.5 3v3" />
              </svg>
            </span>
            暂无贡献数据（接口未返回，稍后重试）
          </div>
        )}
      </section>

      {/* 热力图卡片与下方「最近提交」之间的细分隔线 */}
      <div className="changelog__rule" aria-hidden="true" />

      {/* ── 本仓库全部提交（前台 apps/blog / 后台 apps/cms 两条线，卡片内部滚动） ── */}
      <div className="changelog__divider">
        <span className="changelog__divider-line" />
        <span className="changelog__divider-text">仓库提交记录</span>
        <span className="changelog__divider-hint">
          {data?.repo ?? 'cloud-blog'} · 全部提交
          {totalCommits ? ` · 共 ${totalCommits} 条` : ''}
        </span>
        <span className="changelog__divider-line" />
      </div>

      {error ? (
        <div className="changelog__error">
          数据加载失败（{error}）
          <button type="button" className="changelog__retry" onClick={() => void loadData(year, true)}>
            重试
          </button>
        </div>
      ) : null}

      <div className="changelog__repos">
        {(data?.groups ?? []).map((group, index) => (
          <article className="changelog__repo" key={group.key}>
            <header className="changelog__repo-head">
              <span className={`changelog__repo-badge changelog__repo-badge--${GROUP_TINT[index % GROUP_TINT.length]}`}>
                {group.key === 'blog' ? (
                  // 前台：显示器
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
                    <path d="M9 19.5h6M12 16.5v3" />
                  </svg>
                ) : (
                  // 后台：服务器机箱
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3.5" y="4" width="17" height="7" rx="1.8" />
                    <rect x="3.5" y="13" width="17" height="7" rx="1.8" />
                    <path d="M7 7.5h.01M7 16.5h.01" />
                  </svg>
                )}
              </span>
              <div className="changelog__repo-titles">
                <h3 className="changelog__repo-name">{group.label}</h3>
                <p className="changelog__repo-hint">{group.hint}</p>
              </div>
              <span className={`changelog__repo-count changelog__repo-count--${GROUP_TINT[index % GROUP_TINT.length]}`}>
                {group.error && !group.commits.length
                  ? '—'
                  : `${group.total ?? group.commits.length} 条${group.truncated ? '+' : ''}`}
              </span>
            </header>

            {group.commits.length ? (
              <ol className="changelog__timeline">
                {group.commits.map((commit) => (
                  <li className="changelog__commit" key={commit.sha + commit.date}>
                    <span className="changelog__commit-dot" aria-hidden="true" />
                    <div className="changelog__commit-body">
                      <time className="changelog__commit-time">{formatLabel(commit.date)}</time>
                      <a
                        className="changelog__commit-msg"
                        href={commit.url || '#'}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={commit.message}
                      >
                        {commit.message || '(无提交信息)'}
                      </a>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="changelog__empty">
                <span className="changelog__empty-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h5l1.5 2.5h3L15 12h5" />
                    <path d="M6.5 5.5h11l2.5 6.5v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17v-5z" />
                  </svg>
                </span>
                {group.error ? `加载失败：${group.error}` : '暂无提交记录'}
              </div>
            )}
          </article>
        ))}

        {loading && !data
          ? Array.from({ length: 2 }).map((_, i) => (
              <article className="changelog__repo changelog__repo--skeleton" key={`sk-${i}`}>
                <span className="changelog__skeleton-line" />
                <span className="changelog__skeleton-line changelog__skeleton-line--short" />
                <span className="changelog__skeleton-line" />
              </article>
            ))
          : null}
      </div>
    </div>
  )
}
