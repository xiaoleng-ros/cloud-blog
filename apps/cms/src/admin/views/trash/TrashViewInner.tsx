'use client'

/**
 * 回收站内容（client 组件，由 TrashView server 包装渲染在 DefaultTemplate 布局内）
 *
 * 功能：
 * 1. 文章 / 随笔两个 Tab，列出软删除文档（where deletedAt exists + ?trash=true）
 * 2. 标题模糊搜索 + 发布时间日期范围过滤
 * 3. 「恢复」→ 清空 deletedAt；「彻底删除」→ 二次确认后硬删
 *
 * 表格 / Tab / 分页 / 确认框复用草稿箱的 drafts__* 通用类；
 * 加载中仅刷新数据区，页头 / Tab / 工具栏骨架常驻。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { clip, extractNames, fmt, tagPill } from '../lib/format'
import {
  deleteTrashedDoc,
  listDocs,
  restoreDoc,
  type AdminNote,
  type AdminPost,
} from '../lib/api'

type Tab = 'posts' | 'notes'

/** 待彻底删除确认信息 */
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
  const [deleting, setDeleting] = useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

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

  /** 恢复：清空 deletedAt 后刷新当前页 */
  const handleRestore = async (row: TrashRow) => {
    setBusyId(row.id)
    try {
      await restoreDoc(tab, row.id)
      await load()
    } catch (error) {
      alert(`恢复失败：${(error as Error).message}`)
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
      setDeleting(null)
      await load()
    } catch (error) {
      alert(`彻底删除失败：${(error as Error).message}`)
      setDeleting(null)
    } finally {
      setBusyId(null)
    }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 10)), [total])

  return (
    <div className="drafts trash">
      <PageHeader
        eyebrow="Trash"
        title="回收站"
        desc="已删除的文章与随笔会先进入这里，可恢复或彻底删除。"
      />

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

      {/* 工具栏：标题搜索 + 发布时间范围 */}
      <div className="trash__toolbar">
        <input
          type="search"
          className="trash__search"
          placeholder="搜索标题..."
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          aria-label="搜索标题"
        />
        <div className="trash__daterange">
          <input
            type="date"
            className="trash__date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            aria-label="开始日期"
          />
          <span className="trash__date-sep" aria-hidden="true">→</span>
          <input
            type="date"
            className="trash__date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            aria-label="结束日期"
          />
        </div>
      </div>

      <div className="drafts__list">
        <table className="drafts__table">
          <thead>
            <tr>
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
                <td colSpan={8}>
                  <p className="drafts__empty">加载中…</p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <p className="drafts__empty">暂无数据</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
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
    </div>
  )
}

export default TrashViewInner
