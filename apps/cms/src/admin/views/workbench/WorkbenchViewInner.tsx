'use client'

/**
 * 工作台主体：一份统一的待处理队列。
 *
 * 版式刻意照抄评论管理（CommentsViewInner）——同样的根类 `drafts comments`、
 * 同样的页头胶囊、同样的 `.comments__panes` 双栏、同样的工具栏 + 表格 + 分页脚、
 * 同样的右栏详情 / 空态。样式类直接复用评论页那套，不新造轮子。
 *
 * 数据来源（同源相对路径，登录态由 cookie 会话兜住）：
 * - 草稿文章：GET /api/posts?where[status][equals]=draft&limit=50&depth=0
 * - 草稿随笔：GET /api/notes?where[status][equals]=draft&limit=50&depth=0
 * - 待审评论：GET /api/comments?status=waiting&pageSize=50
 *   返回的是「根评论 + 回复」的线程森林，这里展平后只保留 status=waiting 的条目，
 *   保证埋在已通过父评论下的待审回复也能进队列（评论页自己也是这个口径）。
 */
import { Link, useConfig } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { ShellIcon } from '../../shell/icons'
import { REQUEST_TIMEOUT_MS } from '../lib/api'

/** 队列条目类型 */
type QueueKind = 'post' | 'note' | 'comment'

/** 筛选口径：与评论页的胶囊一一对应 */
type FilterKey = 'all' | 'draft' | 'waiting'

/** 统一后的待处理条目 */
type QueueItem = {
  /** 稳定唯一键（跨来源不能只靠 id） */
  key: string
  kind: QueueKind
  /** 表格「事项」列：文章标题 / 随笔标题 / 评论摘要 */
  title: string
  /** 表格「说明」列：分类 / 所属文章 / 来源 */
  desc: string
  /** ISO 时间或 null */
  time: string | null
  /** 「去处理」跳转目标 */
  href: string
  /** 右栏详情正文 */
  detailText: string
  /** 右栏元信息键值对 */
  meta: Array<[string, string]>
}

/** 评论线程节点（只取用到的字段） */
type CommentNode = {
  id: number
  nick: string
  mail: string
  link: string
  url: string
  text: string
  status: string
  createdAt: string | null
  addr: string
  parentId: number | null
  replies: CommentNode[]
}

/** Payload REST 列表响应 */
type ListResponse<T> = {
  docs: T[]
  totalDocs: number
}

/** 评论列表响应 */
type CommentsResponse = {
  rows: CommentNode[]
  total: number
  posts: Record<string, string>
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿内容' },
  { key: 'waiting', label: '待审评论' },
]

/** 截断长文本，避免把表格列撑开 */
const clip = (value: string, max = 40) => {
  const v = value.trim()
  if (!v) return '（空）'
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/** 日期转中文短格式；无值返回 '—' */
const fmtShort = (value?: string | null) => {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 线程森林 → 展平列表（深度优先，父在前） */
const flatten = (rows: CommentNode[]): CommentNode[] => {
  const out: CommentNode[] = []
  const walk = (list: CommentNode[]) => {
    for (const row of list) {
      out.push(row)
      walk(row.replies ?? [])
    }
  }
  walk(rows)
  return out
}

const KIND_META: Record<QueueKind, { label: string; pill: string; icon: 'posts' | 'note' | 'comments' }> = {
  post: { label: '文章草稿', pill: 'comments__pill--other', icon: 'posts' },
  note: { label: '随笔草稿', pill: 'comments__pill--other', icon: 'note' },
  comment: { label: '待审评论', pill: 'comments__pill--waiting', icon: 'comments' },
}

export const WorkbenchViewInner = () => {
  const { config } = useConfig()
  const adminRoute = config.routes.admin

  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const [postsRes, notesRes, commentsRes] = await Promise.all([
          fetch('/api/posts?limit=50&depth=0&where[status][equals]=draft', { signal: controller.signal }),
          fetch('/api/notes?limit=50&depth=0&where[status][equals]=draft', { signal: controller.signal }),
          fetch('/api/comments?status=waiting&pageSize=50', { signal: controller.signal }),
        ])

        const toJson = async <T,>(res: Response): Promise<T> => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return (await res.json()) as T
        }

        const [posts, notes, comments] = await Promise.all([
          toJson<ListResponse<{ id: number; title?: string; description?: string; createdAt?: string }>>(postsRes),
          toJson<ListResponse<{ id: number; title?: string; mood?: string; description?: string; date?: string }>>(notesRes),
          toJson<CommentsResponse>(commentsRes),
        ])

        const postTitle = (url: string) => comments.posts?.[url] || url || '（未知文章）'
        const next: QueueItem[] = []

        for (const doc of posts.docs) {
          next.push({
            key: `post-${doc.id}`,
            kind: 'post',
            title: doc.title?.trim() || '（无标题）',
            desc: '还没发布的文章',
            time: doc.createdAt ?? null,
            href: `${adminRoute}/collections/posts/${doc.id}`,
            detailText: doc.description?.trim() || '（这篇文章还没有写摘要）',
            meta: [
              ['类型', '文章草稿'],
              ['创建时间', fmtShort(doc.createdAt)],
              ['状态', '草稿 · 未发布'],
            ],
          })
        }

        for (const doc of notes.docs) {
          next.push({
            key: `note-${doc.id}`,
            kind: 'note',
            title: doc.title?.trim() || doc.mood?.trim() || '（无标题）',
            desc: '还没发布的随笔',
            time: doc.date ?? null,
            href: `${adminRoute}/collections/notes/${doc.id}`,
            detailText: doc.description?.trim() || '（这篇随笔还没有写摘要）',
            meta: [
              ['类型', '随笔草稿'],
              ['日期', fmtShort(doc.date)],
              ['状态', '草稿 · 未发布'],
            ],
          })
        }

        for (const row of flatten(comments.rows)) {
          if (row.status !== 'waiting') continue
          next.push({
            key: `comment-${row.id}`,
            kind: 'comment',
            title: `${row.nick || '匿名'}：${clip(row.text, 30)}`,
            desc: postTitle(row.url),
            time: row.createdAt,
            // 评论页用 #c{id} 还原选中项，直接带哈希深链过去
            href: `${adminRoute}/comments#c${row.id}`,
            detailText: row.text || '（空评论）',
            meta: [
              ['评论者', row.nick || '匿名'],
              ['邮箱', row.mail || '—'],
              ['所属文章', postTitle(row.url)],
              ['时间', fmtShort(row.createdAt)],
              ['属地', row.addr || '—'],
            ],
          })
        }

        // 新的在前：草稿按创建时间、随笔按日期、评论按插入时间，统一倒序
        next.sort((a, b) => {
          const ta = a.time ? new Date(a.time).getTime() : 0
          const tb = b.time ? new Date(b.time).getTime() : 0
          return tb - ta
        })

        setItems(next)
        setError('')
      } catch (e) {
        setError(e instanceof Error && e.name === 'AbortError' ? '加载超时，请重试' : '加载失败，请刷新页面重试')
      } finally {
        clearTimeout(timer)
        setLoading(false)
      }
    }

    void load()
  }, [adminRoute])

  const counts: Record<FilterKey, number> = useMemo(
    () => ({
      all: items.length,
      draft: items.filter((i) => i.kind !== 'comment').length,
      waiting: items.filter((i) => i.kind === 'comment').length,
    }),
    [items],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === 'draft' && item.kind === 'comment') return false
      if (filter === 'waiting' && item.kind !== 'comment') return false
      if (!kw) return true
      return `${item.title} ${item.desc}`.toLowerCase().includes(kw)
    })
  }, [items, filter, keyword])

  const selected = filtered.find((i) => i.key === selectedKey) ?? null

  const resetFilters = () => {
    setFilter('all')
    setKeyword('')
  }

  return (
    <div className="drafts comments workbench">
      <PageHeader
        title="工作台"
        actions={
          <div className="comments__filters" role="tablist" aria-label="待处理类型筛选">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                className={`comments__chip${filter === item.key ? ' comments__chip--active' : ''}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                {!loading && counts[item.key] > 0 && <i className="comments__badge">{counts[item.key]}</i>}
              </button>
            ))}
          </div>
        }
      />

      {error && <p className="comments__banner">{error}</p>}

      <div className="comments__panes">
        {/* 左：工具栏 + 待处理表格 */}
        <section className="comments__card">
          <div className="comments__toolbar">
            <label className="comments__search">
              <ShellIcon name="search" size={16} />
              <input
                type="search"
                placeholder="搜索标题或摘要..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索待处理事项"
              />
            </label>
            <button
              type="button"
              className="comments__reset"
              onClick={resetFilters}
              aria-label="重置筛选"
              title="重置"
            >
              <ShellIcon name="close" size={16} />
            </button>
            <span className="comments__hint">点击行查看详情与入口</span>
          </div>

          <div className="comments__table-wrap" aria-busy={loading || undefined}>
            <table className="drafts__table comments__table">
              <thead>
                <tr>
                  <th className="comments__col-nick">类型</th>
                  <th>事项</th>
                  <th className="comments__col-post">说明</th>
                  <th className="comments__col-time">时间</th>
                  <th className="comments__col-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <tr className="comments__tr" key={i} aria-hidden="true">
                      {['70%', '88%', '56%', '64%', '80%'].map((width) => (
                        <td key={width}>
                          <span className="comments__skel-line" style={{ width }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="comments__state">
                        <p className="comments__state-msg">{error}</p>
                        <button type="button" className="drafts__op" onClick={resetFilters}>
                          重置筛选
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="comments__state">
                        <span className="comments__state-icon" aria-hidden="true">
                          <ShellIcon name="posts" size={24} />
                        </span>
                        <p className="comments__state-msg">
                          {keyword.trim() || filter !== 'all' ? '未找到匹配的待处理事项' : '暂无待处理事项'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const meta = KIND_META[item.kind]
                    const isActive = item.key === selectedKey
                    return (
                      <tr
                        key={item.key}
                        className={`comments__tr${isActive ? ' comments__tr--active' : ''}`}
                        onClick={() => setSelectedKey(isActive ? null : item.key)}
                      >
                        <td>
                          <span className="comments__nick-line">
                            <span className="workbench__kind-icon" aria-hidden="true">
                              <ShellIcon name={meta.icon} size={15} />
                            </span>
                            <i className={`comments__pill ${meta.pill}`}>{meta.label}</i>
                          </span>
                        </td>
                        <td className="comments__cell-text" title={item.title}>
                          {item.title}
                        </td>
                        <td className="comments__cell-post" title={item.desc}>
                          {item.desc}
                        </td>
                        <td className="comments__cell-time">{fmtShort(item.time)}</td>
                        <td className="comments__cell-ops">
                          <Link
                            className="comments__quick"
                            href={item.href}
                            prefetch={false}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          >
                            去处理
                          </Link>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <footer className="comments__list-foot">
            <span className="comments__foot-info">共 {filtered.length} 项待处理</span>
          </footer>
        </section>

        {/* 右：选中项详情 */}
        <aside className="comments__card">
          {selected ? (
            <>
              <header className="comments__card-head">
                <h3 className="comments__card-title">{selected.title}</h3>
                <i className={`comments__pill ${KIND_META[selected.kind].pill}`}>
                  {KIND_META[selected.kind].label}
                </i>
              </header>
              <div className="comments__detail-body">
                <p className="comments__detail-text">{selected.detailText}</p>
                <dl className="comments__meta">
                  {selected.meta.map(([label, value]) => (
                    <div className="comments__meta-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <footer className="comments__detail-foot">
                <Link className="comments__act" href={selected.href} prefetch={false}>
                  去处理 →
                </Link>
              </footer>
            </>
          ) : (
            <div className="comments__detail-empty">
              <span className="comments__state-icon" aria-hidden="true">
                <ShellIcon name="posts" size={24} />
              </span>
              <p className="comments__state-title">选择一项待处理</p>
              <p className="comments__state-sub">在左侧列表点击任意行，可在此查看完整内容与处理入口</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default WorkbenchViewInner
