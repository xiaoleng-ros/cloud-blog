'use client'

/**
 * 回收站内容（client 组件，由 TrashView server 包装渲染在 DefaultTemplate 布局内）
 *
 * 功能：
 * 1. 文章 / 随笔两个 Tab，列出软删除文档（where deletedAt exists + ?trash=true）
 * 2. 标题模糊搜索 + 发布时间日期范围过滤
 * 3. 「恢复」→ 清空 deletedAt；「彻底删除」→ 二次确认后硬删
 * 4. 多选：勾选列 + 批量恢复 / 批量彻底删除（串行 + 进度显示）
 *
 * 表格 / Tab / 分页 / 确认框复用草稿箱的 drafts__* 通用类；
 * 加载中仅刷新数据区，页头 / Tab / 工具栏骨架常驻。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { DateRangeField } from '../../components/DateField'
import { Toast, useToast } from '../../components/Toast'
import { clip, extractNames, fmt, tagPill } from '../lib/format'
import {
  deleteTrashedDoc,
  describeApiError,
  listDocs,
  restoreDoc,
  type AdminNote,
  type AdminPost,
} from '../lib/api'

type Tab = 'posts' | 'notes'

/** 待彻底删除确认信息（单条） */
interface ConfirmState {
  collection: Tab
  id: number
  title: string
}

/** 回收站行结构（文章/随笔归一化） */
interface TrashRow {
  id: number
  title: string
  excerpt: string
  categoryNames: string[]
  tagNames: string[]
  /** 发布时间：文章取 createdAt，随笔取 date 字段 */
  publishedAt?: string
}

export const TrashViewInner = () => {
  const [tab, setTab] = useState<Tab>('posts')
  const [titleInput, setTitleInput] = useState('')
  // 搜索防抖后的实际生效关键词
  const [keyword, setKeyword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<TrashRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // ---- 多选 ----
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // ---- 单条操作 ----
  const [deleting, setDeleting] = useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // ---- 批量操作 ----
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<number[] | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const { toast, show } = useToast()

  // 输入停顿 400ms 后才发起查询，避免每敲一个字打一次 API
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(titleInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [titleInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 日期范围按发布时间过滤：文章比 createdAt，随笔比 date 字段
      const dateField = tab === 'posts' ? 'createdAt' : 'date'
      const and: Record<string, unknown>[] = [{ deletedAt: { exists: true } }]
      if (keyword) and.push({ title: { like: keyword } })
      if (from) and.push({ [dateField]: { greater_than_equal: from } })
      if (to) and.push({ [dateField]: { less_than_equal: to } })

      const res = await listDocs<AdminPost | AdminNote>(
        tab,
        { and },
        page,
        10,
        `-createdAt`,
        true,
      )
      setTotal(res.totalDocs)
      setRows(
        res.docs.map((d) => {
          const post = d as AdminPost
          const note = d as AdminNote
          return {
            id: d.id,
            title: (d.title ?? '').trim() || '（无标题）',
            excerpt:
              tab === 'posts'
                ? (post.description ?? '').trim() || clip(post.content) || '—'
                : (note.mood ?? '').trim() || clip(note.content) || '—',
            categoryNames: extractNames(d.categories),
            tagNames: extractNames(d.tags),
            publishedAt: tab === 'posts' ? post.createdAt : note.date ?? post.createdAt,
          }
        }),
      )
      setSelected(new Set())
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [tab, keyword, from, to, page])

  useEffect(() => {
    void load()
  }, [load])

  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(1)
  }

  // ---- 多选控制 ----

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allOnPageSelected) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  // ---- 单条操作 ----

  /** 恢复：清空 deletedAt 后刷新当前页 */
  const handleRestore = async (row: TrashRow) => {
    setBusyId(row.id)
    try {
      await restoreDoc(tab, row.id)
      show('success', '已恢复')
      await load()
    } catch (error) {
      show('error', `恢复失败：${describeApiError(error)}`)
    } finally {
      setBusyId(null)
    }
  }

  /** 确认彻底删除后刷新列表 */
  const confirmDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await deleteTrashedDoc(deleting.collection, deleting.id)
      show('success', '已彻底删除')
      setDeleting(null)
      await load()
    } catch (error) {
      show('error', `彻底删除失败：${describeApiError(error)}`)
      setDeleting(null)
    } finally {
      setBusyId(null)
    }
  }

  // ---- 批量操作 ----

  /** 批量恢复：串行提交，不弹确认框（恢复是安全操作） */
  const handleBatchRestore = async () => {
    if (selected.size === 0) return
    setBatchBusy(true)

    const ids = [...selected]
    let ok = 0
    let fail = 0

    for (let i = 0; i < ids.length; i++) {
      setBatchProgress({ current: i + 1, total: ids.length })
      try {
        await restoreDoc(tab, ids[i])
        ok++
      } catch {
        fail++
      }
    }

    setBatchProgress(null)
    setBatchBusy(false)
    setSelected(new Set())
    await load()

    if (fail === 0) {
      show('success', ok > 1 ? `已恢复 ${ok} 条` : '已恢复')
    } else if (ok > 0) {
      show('error', `恢复 ${ok} 条，失败 ${fail} 条（请刷新确认）`)
    } else {
      show('error', '恢复失败：后台响应过慢。请刷新列表确认真实状态')
    }
  }

  /** 确认批量彻底删除后逐条硬删 */
  const confirmBatchDeleteAction = async () => {
    if (!confirmBatchDelete || confirmBatchDelete.length === 0) return
    setBatchBusy(true)

    const ids = confirmBatchDelete
    let ok = 0
    let fail = 0

    for (let i = 0; i < ids.length; i++) {
      setBatchProgress({ current: i + 1, total: ids.length })
      try {
        await deleteTrashedDoc(tab, ids[i])
        ok++
      } catch {
        fail++
      }
    }

    setBatchProgress(null)
    setBatchBusy(false)
    setConfirmBatchDelete(null)
    setSelected(new Set())
    await load()

    if (fail === 0) {
      show('success', ok > 1 ? `已彻底删除 ${ok} 条` : '已彻底删除')
    } else if (ok > 0) {
      show('error', `删除 ${ok} 条，失败 ${fail} 条（部分可能已删除，请刷新确认）`)
    } else {
      show('error', '删除失败：后台响应过慢。请刷新列表确认真实状态')
    }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 10)), [total])

  const colCount = 9 // 勾选 + 标题 + 摘要 + 分类 + 标签 + 浏览 + 评论 + 发布时间 + 操作

  return (
    <div className="drafts trash">
      <PageHeader title="回收站" />

      <div className="drafts__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'posts'}
          className={`drafts__tab${tab === 'posts' ? ' drafts__tab--active' : ''}`}
          onClick={() => switchTab('posts')}
        >
          文章
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notes'}
          className={`drafts__tab${tab === 'notes' ? ' drafts__tab--active' : ''}`}
          onClick={() => switchTab('notes')}
        >
          随笔
        </button>
      </div>

      {/* 工具栏：标题搜索 + 发布时间范围 + 批量操作 */}
      <div className="trash__toolbar">
        <input
          type="search"
          className="trash__search"
          placeholder="搜索标题..."
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          aria-label="搜索标题"
        />
        <DateRangeField
          from={from}
          to={to}
          onChange={(range) => {
            setFrom(range.from)
            setTo(range.to)
            setPage(1)
          }}
        />

        <div className="manage__actions">
          <button
            type="button"
            className="manage__action"
            disabled={selected.size === 0 || batchBusy}
            onClick={() => void handleBatchRestore()}
          >
            批量恢复{selected.size ? `（${selected.size}）` : ''}
          </button>
          <button
            type="button"
            className="manage__action manage__action--danger"
            disabled={selected.size === 0 || batchBusy}
            onClick={() => setConfirmBatchDelete([...selected])}
          >
            批量彻底删除{selected.size ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      <div className="drafts__list">
        <table className="drafts__table">
          <thead>
            <tr>
              <th className="manage__check-col">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  aria-label="全选本页"
                />
              </th>
              <th>标题</th>
              <th>摘要</th>
              <th>分类</th>
              <th>标签</th>
              <th>浏览量</th>
              <th>评论</th>
              <th>发布时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount}>
                  <p className="drafts__empty">加载中…</p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <p className="drafts__empty">暂无数据</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="manage__check-col">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`选择 ${row.title}`}
                    />
                  </td>
                  <td className="drafts__cell-title">{row.title}</td>
                  <td className="drafts__cell-desc">{row.excerpt}</td>
                  <td>{tagPill(row.categoryNames)}</td>
                  <td>{tagPill(row.tagNames)}</td>
                  {/* 浏览量 / 评论：新后台暂无数据源，占位展示 */}
                  <td className="drafts__muted">—</td>
                  <td className="drafts__muted">—</td>
                  <td className="drafts__cell-date">{fmt(row.publishedAt)}</td>
                  <td className="drafts__cell-ops">
                    <button
                      type="button"
                      className="drafts__op"
                      disabled={busyId === row.id}
                      onClick={() => void handleRestore(row)}
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      disabled={busyId === row.id}
                      onClick={() =>
                        setDeleting({ collection: tab, id: row.id, title: row.title })
                      }
                    >
                      彻底删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 10 && (
        <div className="drafts__pager">
          <button type="button" className="drafts__op" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span className="drafts__pager-info">{page} / {pageCount}（共 {total} 条）</span>
          <button
            type="button"
            className="drafts__op"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {/* 单条彻底删除确认 */}
      {deleting && (
        <div className="drafts__confirm-mask" onClick={() => setDeleting(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认彻底删除</h3>
            <p>「{deleting.title}」将被永久删除，无法恢复，确定继续吗？</p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setDeleting(null)}>取消</button>
              <button type="button" className="drafts__op drafts__op--danger" onClick={() => void confirmDelete()}>
                彻底删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量彻底删除确认（带进度显示） */}
      {confirmBatchDelete && (
        <div className="drafts__confirm-mask" onClick={() => !batchBusy && setConfirmBatchDelete(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认批量彻底删除</h3>
            <p>
              确定将选中的 {confirmBatchDelete.length} 条内容永久删除吗？此操作无法恢复。
            </p>
            {batchProgress && (
              <p className="manage__delete-progress">
                删除中 {batchProgress.current} / {batchProgress.total}…
              </p>
            )}
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" disabled={batchBusy} onClick={() => setConfirmBatchDelete(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={batchBusy}
                onClick={() => void confirmBatchDeleteAction()}
              >
                {batchProgress ? '删除中…' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量恢复进度（覆盖层，不阻塞页面） */}
      {batchProgress && !confirmBatchDelete && (
        <div className="drafts__confirm-mask" style={{ pointerEvents: 'none' }}>
          <div className="drafts__confirm" style={{ pointerEvents: 'none' }}>
            <p className="manage__delete-progress">
              恢复中 {batchProgress.current} / {batchProgress.total}…
            </p>
          </div>
        </div>
      )}

      {/* 非阻塞 toast */}
      <Toast toast={toast} />
    </div>
  )
}

export default TrashViewInner
