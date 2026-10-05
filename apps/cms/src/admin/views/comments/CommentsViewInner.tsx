'use client'

/**
 * 评论管理内容（client 组件，由 CommentsView server 包装渲染在 DefaultTemplate 布局内）
 *
 * 数据来源是进程内 Waline：本视图只调同源 `/api/comments`，服务端用自铸的管理员令牌转调
 * （见 src/lib/waline-admin.ts），浏览器永远拿不到令牌，也不直接打公开 `/api/waline`。
 *
 * 版式：左卡 = 卡内工具栏（搜索 / 日期范围 / 重置 / 右侧提示）+ 五列表格；右卡 = 选中评论详情。
 * 表格一行是一条根评论，带回复的行首有箭头，就地展开整棵回复树（缩进一格一层）。
 * 状态筛选是审核队列水位，放在页头右侧，不占两张卡的位置。
 * 页面不滚，滚动只在左卡表格区发生；加载中表格只出骨架行，工具栏 / 表头 / 右卡占位从 SSR 首帧就在
 * （「禁止闪错误态」约定）。选中的评论写进 URL 哈希（#c{id}），刷新后尽量回到同一条（含回复）。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { DateRangeField } from '../../components/DateField'
import {
  deleteComment,
  describeApiError,
  listComments,
  setCommentStatus,
  type CommentFilter,
  type CommentRow,
} from '../lib/api'

const PAGE_SIZE = 10

/** 状态筛选顺序与文案（待审 / 垃圾带数量角标） */
const FILTERS: Array<{ key: CommentFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'waiting', label: '待审' },
  { key: 'approved', label: '已通过' },
  { key: 'spam', label: '垃圾' },
]

/** Waline 的状态值 → 后台展示的中文与样式 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  waiting: { label: '待审', className: 'comments__pill--waiting' },
  approved: { label: '已通过', className: 'comments__pill--approved' },
  spam: { label: '垃圾', className: 'comments__pill--spam' },
}

const statusMeta = (status: string) =>
  STATUS_META[status] ?? { label: status || '未知', className: 'comments__pill--other' }

/** 详情用完整时间 */
const fmtDateTime = (value?: string | null) => {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 列表行用短时间（当年省略年份） */
const fmtShort = (value?: string | null) => {
  const d = value ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/** Waline 存的是提交页地址（完整 URL 或裸路径），展示只留路径 */
const postPath = (url: string) => {
  if (!url) return '—'
  try {
    return new URL(url, 'http://local').pathname
  } catch {
    return url
  }
}

/** 访客网址只放行 http(s)，其余按纯文字展示 */
const safeLink = (href: string) => (/^https?:\/\//i.test(href) ? href : '')

const clip = (text: string, max = 60) => {
  const plain = text.replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

const glyph = (paths: React.ReactNode, size = 14) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths}
  </svg>
)

const searchGlyph = glyph(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
)

const resetGlyph = glyph(
  <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </>,
)

const clickGlyph = glyph(
  <path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.94l-6.13 1.58a2 2 0 0 0-1.43 1.44l-1.58 6.12a.5.5 0 0 1-.95.07z" />,
  13,
)

const trayGlyph = glyph(
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>,
  22,
)

const chatGlyph = glyph(<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />, 22)

/** 行内动作：按当前状态只给出用得上的那几个 */
type RowAction = 'approve' | 'spam' | 'waiting' | 'delete'

const rowActions = (row: CommentRow): Array<{ label: string; run: RowAction; danger?: boolean }> => {
  const actions: Array<{ label: string; run: RowAction; danger?: boolean }> = [
    row.status !== 'approved' ? { label: '批准', run: 'approve' } : { label: '退回', run: 'waiting' },
  ]
  if (row.status !== 'spam') actions.push({ label: '垃圾', run: 'spam' })
  actions.push({ label: '删除', run: 'delete', danger: true })
  return actions
}

/** 把一棵回复子树摊平成「行 + 相对根的层深」，表格才能一行一格地渲染 */
const flattenReplies = (node: CommentRow, depth = 1): Array<{ row: CommentRow; depth: number }> =>
  node.replies.flatMap((child) => [
    { row: child, depth },
    ...flattenReplies(child, depth + 1),
  ])

export const CommentsViewInner = () => {
  const [filter, setFilter] = useState<CommentFilter>('waiting')
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<CommentRow[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [waitingCount, setWaitingCount] = useState(0)
  const [spamCount, setSpamCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirmRow, setConfirmRow] = useState<CommentRow | null>(null)
  // 列表请求序号：快速切换筛选时只采用最新响应，丢弃过期响应（防竞态覆盖）
  const reqSeq = useRef(0)
  // 选中项同步存一份 ref：load 读它而不进依赖表，否则点一行就要重拉一次列表
  const selectedIdRef = useRef<number | null>(null)
  // 首次加载时从哈希还原同一条评论；之后 selectedId 变化再同步回哈希
  const initialHashRef = useRef<number | null>(
    typeof window === 'undefined' ? null : Number(window.location.hash.replace(/^#c/, '')) || null,
  )
  const hashReadyRef = useRef(false)

  const select = (id: number | null) => {
    selectedIdRef.current = id
    setSelectedId(id)
  }

  // 输入停顿 400ms 后才发起查询，避免每敲一个字打一次 API
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (!hashReadyRef.current) return
    const url =
      selectedId === null ? window.location.pathname + window.location.search : `#c${selectedId}`
    window.history.replaceState(null, '', url)
  }, [selectedId])

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setLoading(true)
    try {
      const res = await listComments({ filter, page, pageSize: PAGE_SIZE, keyword, from, to })
      if (seq !== reqSeq.current) return
      setRows(res.rows)
      setTitles(res.posts)
      setTotal(res.total)
      setTotalPages(res.totalPages)
      setWaitingCount(res.waitingCount)
      setSpamCount(res.spamCount)
      setListError('')
      // 服务端会把越界页码钳回有效范围（删最后一条等场景），跟随它收敛
      if (res.page !== page && res.page !== 0) setPage(res.page)

      // 选中项：优先保持当前选中；首次加载可还原哈希；不在本页数据里就取消选中
      const hashCandidate = initialHashRef.current
      initialHashRef.current = null
      const candidate = selectedIdRef.current ?? hashCandidate
      const index = indexRows(res.rows)
      if (candidate === null) select(null)
      else if (!index.has(candidate)) select(null)
      else {
        // 命中的是挂在别人下面的回复：先展开它的整条祖先链，否则选中态在页面上根本看不见
        const chain = ancestorIds(index.get(candidate)!, index)
        if (chain.length) setExpanded((prev) => new Set([...prev, ...chain]))
        // 哈希还原来的那一条还没进 state，不补这一下就只有展开、没有选中
        if (selectedIdRef.current !== candidate) select(candidate)
      }
      hashReadyRef.current = true
    } catch (error) {
      if (seq !== reqSeq.current) return
      setRows([])
      setTitles({})
      setTotal(0)
      setTotalPages(0)
      setListError(describeApiError(error))
      hashReadyRef.current = true
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [filter, page, keyword, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo<Record<CommentFilter, number | null>>(
    () => ({ all: null, waiting: waitingCount, approved: null, spam: spamCount }),
    [waitingCount, spamCount],
  )

  /** 展平索引：详情面板与哈希还原都要按 id 找到任意一层评论 */
  const rowIndex = useMemo(() => indexRows(rows), [rows])
  const selected = useMemo(
    () => (selectedId === null ? null : rowIndex.get(selectedId) ?? null),
    [rowIndex, selectedId],
  )

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const resetFilters = () => {
    setSearchInput('')
    setKeyword('')
    setFrom('')
    setTo('')
    setFilter('all')
    setPage(1)
  }

  /** 行内 / 详情动作：改状态后刷新当前页（角标数字也要跟着变） */
  const changeStatus = async (row: CommentRow, status: 'approved' | 'spam' | 'waiting') => {
    setBusyId(row.id)
    setActionError('')
    try {
      await setCommentStatus(row.id, status)
      await load()
    } catch (error) {
      setActionError(describeApiError(error))
    } finally {
      setBusyId(null)
    }
  }

  /** 确认删除后刷新列表 */
  const confirmDelete = async () => {
    if (!confirmRow) return
    setBusyId(confirmRow.id)
    setActionError('')
    try {
      await deleteComment(confirmRow.id)
      setConfirmRow(null)
      await load()
    } catch (error) {
      setActionError(describeApiError(error))
      setConfirmRow(null)
    } finally {
      setBusyId(null)
    }
  }

  const runAction = (row: CommentRow, action: RowAction) => {
    if (action === 'delete') setConfirmRow(row)
    else void changeStatus(row, action === 'approve' ? 'approved' : action)
  }

  const pageCount = Math.max(1, totalPages)
  const article = (url: string) => titles[url] || postPath(url)
  const filtered = Boolean(keyword || from || to)

  const renderRow = (row: CommentRow, depth: number, expandable: boolean, open: boolean) => {
    const meta = statusMeta(row.status)
    const isActive = row.id === selectedId
    const busy = busyId === row.id
    return (
      <tr
        key={row.id}
        className={`comments__tr${depth ? ' comments__tr--reply' : ''}${isActive ? ' comments__tr--active' : ''}`}
        tabIndex={0}
        aria-current={isActive || undefined}
        onClick={() => select(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            select(row.id)
          }
        }}
      >
        <td className="comments__cell-nick">
          <span className="comments__nick-line" style={depth ? { paddingLeft: depth * 18 } : undefined}>
            {expandable ? (
              <button
                type="button"
                className="comments__caret"
                aria-label={open ? '收起回复' : `展开 ${row.replyCount} 条回复`}
                aria-expanded={open}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand(row.id)
                }}
              >
                {glyph(open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />, 15)}
              </button>
            ) : (
              <span className="comments__caret" aria-hidden="true">
                {depth ? '↳' : ''}
              </span>
            )}
            <span className="comments__nick">{row.nick}</span>
            <i className={`comments__pill ${meta.className}`}>{meta.label}</i>
          </span>
        </td>
        <td className="comments__cell-text" title={row.text}>
          {row.text || '（空评论）'}
        </td>
        {/* 回复和根评论挂同一篇文章，重复五遍没意义 */}
        <td className="comments__cell-post" title={depth ? '' : row.url}>
          {depth ? '—' : article(row.url)}
        </td>
        <td className="comments__cell-time">{fmtShort(row.createdAt)}</td>
        <td className="comments__cell-ops">
          {rowActions(row).map((action) => (
            <button
              key={action.run}
              type="button"
              className={`comments__quick${action.danger ? ' comments__quick--danger' : ''}`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                runAction(row, action.run)
              }}
            >
              {action.label}
            </button>
          ))}
        </td>
      </tr>
    )
  }

  return (
    <div className="drafts comments">
      <PageHeader
        title="评论管理"
        actions={
          <div className="comments__filters" role="tablist" aria-label="评论状态筛选">
            {FILTERS.map((item) => {
              const count = counts[item.key]
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.key}
                  className={`comments__chip${filter === item.key ? ' comments__chip--active' : ''}`}
                  onClick={() => {
                    setFilter(item.key)
                    setPage(1)
                  }}
                >
                  {item.label}
                  {count !== null && count > 0 && <i className="comments__badge">{count}</i>}
                </button>
              )
            })}
          </div>
        }
      />

      {actionError && <p className="comments__banner">{actionError}</p>}

      <div className="comments__panes">
        {/* 左：卡内工具栏 + 评论表格 */}
        <section className="comments__card">
          <div className="comments__toolbar">
            <label className="comments__search">
              {searchGlyph}
              <input
                type="search"
                placeholder="搜索评论内容..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="搜索评论内容"
              />
            </label>
            <DateRangeField
              from={from}
              to={to}
              onChange={(range) => {
                setFrom(range.from)
                setTo(range.to)
                setPage(1)
              }}
            />
            <button
              type="button"
              className="comments__reset"
              onClick={resetFilters}
              aria-label="重置筛选"
              title="重置"
            >
              {resetGlyph}
            </button>
            <span className="comments__hint">
              {clickGlyph}
              点击箭头展开回复，点击行查看详情
            </span>
          </div>

          <div className="comments__table-wrap" aria-busy={loading || undefined}>
            <table className="drafts__table comments__table">
              <thead>
                <tr>
                  <th className="comments__col-nick">评论者</th>
                  <th>评论内容</th>
                  <th className="comments__col-post">所属文章</th>
                  <th className="comments__col-time">评论时间</th>
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
                ) : listError ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="comments__state">
                        <p className="comments__state-msg">{listError}</p>
                        <button type="button" className="drafts__op" onClick={() => void load()}>
                          重新加载
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="comments__state">
                        <span className="comments__state-icon" aria-hidden="true">
                          {trayGlyph}
                        </span>
                        <p className="comments__state-msg">
                          {filtered ? '未找到匹配的评论' : '暂无评论，读者留言后会显示在这里'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const open = expanded.has(row.id)
                    return (
                      <Fragment key={row.id}>
                        {renderRow(row, 0, row.replyCount > 0, open)}
                        {open &&
                          flattenReplies(row).map((item) => renderRow(item.row, item.depth, false, false))}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <footer className="comments__list-foot">
              <span className="comments__foot-info">
                共 {total} 条 · 第 {page} / {pageCount} 页
              </span>
              <span className="comments__foot-pager">
                <button
                  type="button"
                  className="drafts__op"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="drafts__op"
                  disabled={loading || page >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </span>
            </footer>
          )}
        </section>

        {/* 右：选中评论详情 */}
        <aside className="comments__card">
          {selected ? (
            <>
              <header className="comments__card-head">
                <h3 className="comments__card-title">{selected.nick}</h3>
                <i className={`comments__pill ${statusMeta(selected.status).className}`}>
                  {statusMeta(selected.status).label}
                </i>
              </header>
              <div className="comments__detail-body">
                <p className="comments__detail-text">{selected.text || '（空评论）'}</p>
                <dl className="comments__meta">
                  <div className="comments__meta-row">
                    <dt>邮箱</dt>
                    <dd>{selected.mail || '—'}</dd>
                  </div>
                  {selected.link && (
                    <div className="comments__meta-row">
                      <dt>网址</dt>
                      <dd>
                        {safeLink(selected.link) ? (
                          <a href={selected.link} target="_blank" rel="noreferrer noopener">
                            {selected.link}
                          </a>
                        ) : (
                          selected.link
                        )}
                      </dd>
                    </div>
                  )}
                  <div className="comments__meta-row">
                    <dt>所属文章</dt>
                    <dd title={selected.url}>{article(selected.url)}</dd>
                  </div>
                  {selected.parentId !== null && (
                    <div className="comments__meta-row">
                      <dt>上级</dt>
                      <dd>评论 #{selected.parentId}</dd>
                    </div>
                  )}
                  <div className="comments__meta-row">
                    <dt>时间</dt>
                    <dd>{fmtDateTime(selected.createdAt)}</dd>
                  </div>
                  {selected.addr && (
                    <div className="comments__meta-row">
                      <dt>属地</dt>
                      <dd>{selected.addr}</dd>
                    </div>
                  )}
                  {(selected.browser || selected.os) && (
                    <div className="comments__meta-row">
                      <dt>设备</dt>
                      <dd>{[selected.browser, selected.os].filter(Boolean).join(' · ')}</dd>
                    </div>
                  )}
                  {selected.replyCount > 0 && (
                    <div className="comments__meta-row">
                      <dt>回复</dt>
                      <dd>{selected.replyCount} 条</dd>
                    </div>
                  )}
                  {selected.like > 0 && (
                    <div className="comments__meta-row">
                      <dt>点赞</dt>
                      <dd>{selected.like}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <footer className="comments__detail-foot">
                {selected.status !== 'approved' && (
                  <button
                    type="button"
                    className="comments__act comments__act--primary"
                    disabled={busyId === selected.id}
                    onClick={() => void changeStatus(selected, 'approved')}
                  >
                    批准
                  </button>
                )}
                {selected.status === 'approved' && (
                  <button
                    type="button"
                    className="comments__act"
                    disabled={busyId === selected.id}
                    onClick={() => void changeStatus(selected, 'waiting')}
                  >
                    退回待审
                  </button>
                )}
                {selected.status !== 'spam' && (
                  <button
                    type="button"
                    className="comments__act"
                    disabled={busyId === selected.id}
                    onClick={() => void changeStatus(selected, 'spam')}
                  >
                    标垃圾
                  </button>
                )}
                <button
                  type="button"
                  className="comments__act comments__act--danger"
                  disabled={busyId === selected.id}
                  onClick={() => setConfirmRow(selected)}
                >
                  删除
                </button>
              </footer>
            </>
          ) : (
            <div className="comments__detail-empty">
              <span className="comments__state-icon" aria-hidden="true">
                {chatGlyph}
              </span>
              <p className="comments__state-title">选择一条评论</p>
              <p className="comments__state-sub">在左侧列表点击任意行，可在此查看完整内容与联系方式</p>
            </div>
          )}
        </aside>
      </div>

      {confirmRow && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmRow(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除评论</h3>
            <p>「{clip(confirmRow.text, 40)}」将被永久删除（连同它的回复），无法恢复，确定继续吗？</p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setConfirmRow(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={busyId === confirmRow.id}
                onClick={() => void confirmDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 把线程森林展平成 id → 行，供详情面板与哈希还原按 id 取任意一层评论 */
function indexRows(rows: CommentRow[]): Map<number, CommentRow> {
  const map = new Map<number, CommentRow>()
  const walk = (list: CommentRow[]) => {
    for (const row of list) {
      map.set(row.id, row)
      walk(row.replies)
    }
  }
  walk(rows)
  return map
}

/** 自身之外的祖先 id（近父 → 根）；父不在本页数据里就到此为止 */
function ancestorIds(row: CommentRow, index: Map<number, CommentRow>): number[] {
  const chain: number[] = []
  const seen = new Set<number>([row.id])
  let cursor = row.parentId
  while (cursor != null && !seen.has(cursor)) {
    const parent = index.get(cursor)
    if (!parent) break
    chain.push(parent.id)
    seen.add(parent.id)
    cursor = parent.parentId
  }
  return chain
}

export default CommentsViewInner
