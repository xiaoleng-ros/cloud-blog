'use client'

/**
 * 草稿箱内容（client 组件，由 DraftsView server 包装渲染在 DefaultTemplate 布局内）
 *
 * 功能：
 * 1. 文章 / 随笔两个 Tab，各自分页列草案稿（GET /api/*?where[status][equals]=draft）
 * 2. 「编辑」→ 跳转创作页回填（/admin/write-post?id=X&draft=1）
 * 3. 「删除」→ REST 删除后刷新当前页
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useConfig } from '@payloadcms/ui'
import { deleteDoc, listDocs, type AdminNote, type AdminPost } from '../lib/api'

type Tab = 'posts' | 'notes'

/** 待删除确认信息 */
interface ConfirmState {
  collection: Tab
  id: number
}

/** 草稿行公共结构（文章/随笔合并展示） */
interface DraftRow {
  id: number
  title?: string
  mood?: string
  date?: string
  description?: string
  updatedAt?: string
  categoryNames: string[]
  tagNames: string[]
}

/** 格式化日期为短格式 */
const fmt = (v?: string) => {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 小标签渲染（空数组显示占位） */
const tagPill = (names: string[]) =>
  names.length ? (
    <span className="drafts__tags">
      {names.slice(0, 3).map((n, i) => (
        <i key={`${n}-${i}`} className="drafts__tag">{n}</i>
      ))}
      {names.length > 3 && <i className="drafts__tag drafts__tag--more">+{names.length - 3}</i>}
    </span>
  ) : (
    <span className="drafts__muted">—</span>
  )

export const DraftsViewInner = () => {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  // Tab → 创作页视图路由前缀（posts → write-post；notes → write-note）
  const composePath: Record<Tab, string> = { posts: 'write-post', notes: 'write-note' }

  const [tab, setTab] = useState<Tab>('posts')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<ConfirmState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listDocs<AdminPost | AdminNote>(tab, { status: { equals: 'draft' } }, page, 10)
      setTotal(res.totalDocs)
      if (tab === 'posts') {
        setRows(
          (res.docs as AdminPost[]).map((d) => ({
            id: d.id,
            title: d.title ?? '',
            description: d.description ?? '',
            updatedAt: d.updatedAt,
            categoryNames: (d.categories ?? []).map((c) => (typeof c === 'object' ? c.name : String(c))),
            tagNames: (d.tags ?? []).map((t) => (typeof t === 'object' ? t.name : String(t))),
          })),
        )
      } else {
        setRows(
          (res.docs as AdminNote[]).map((d) => ({
            id: d.id,
            title: d.title ?? '',
            mood: d.mood ?? '',
            date: d.date ? String(d.date).slice(0, 10) : undefined,
            updatedAt: d.updatedAt,
            categoryNames: [],
            tagNames: (d.tags ?? []).map((t) => (typeof t === 'object' ? t.name : String(t))),
          })),
        )
      }
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [tab, page])

  // 页码或 Tab 变化时重新加载
  useEffect(() => {
    void load()
  }, [load])

  /** 切换 Tab 时重置页码 */
  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(1)
  }

  /** 确认删除草稿后刷新列表 */
  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteDoc(deleting.collection, deleting.id)
      setDeleting(null)
      void load()
    } catch (error) {
      alert(`删除失败：${(error as Error).message}`)
      setDeleting(null)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / 10))

  return (
    <div className="drafts">
      <header className="drafts__header">
        <p className="drafts__eyebrow">Draft Box</p>
        <h1 className="drafts__title">草稿箱</h1>
        <p className="drafts__desc">未发布的文章与随笔草稿，可编辑后发布或删除。</p>
      </header>

      <div className="drafts__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'posts'}
          className={`drafts__tab${tab === 'posts' ? ' drafts__tab--active' : ''}`}
          onClick={() => switchTab('posts')}
        >
          文章草稿
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notes'}
          className={`drafts__tab${tab === 'notes' ? ' drafts__tab--active' : ''}`}
          onClick={() => switchTab('notes')}
        >
          随笔草稿
        </button>
      </div>

      <div className="drafts__list">
        {loading ? (
          <p className="drafts__empty">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="drafts__empty">{tab === 'posts' ? '暂无文章草稿' : '暂无随笔草稿'}</p>
        ) : (
          <table className="drafts__table">
            <thead>
              <tr>
                <th>{tab === 'posts' ? '标题' : '日期 / 标题'}</th>
                {tab === 'posts' && <th>摘要</th>}
                {tab === 'posts' && <th>分类</th>}
                <th>标签</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="drafts__cell-title">
                    {tab === 'posts' ? (
                      row.title || '（无标题）'
                    ) : (
                      <span>
                        <strong>{row.date ? fmt(row.date) : '未知日期'}</strong>
                        {row.title ? ` · ${row.title}` : row.mood ? ` · ${row.mood}` : ''}
                      </span>
                    )}
                  </td>
                  {tab === 'posts' && <td className="drafts__cell-desc">{row.description || '—'}</td>}
                  {tab === 'posts' && <td>{tagPill(row.categoryNames)}</td>}
                  <td>{tagPill(row.tagNames)}</td>
                  <td className="drafts__cell-date">{fmt(row.updatedAt)}</td>
                  <td className="drafts__cell-ops">
                    <Link
                      href={`${adminRoute}/${composePath[tab]}?id=${row.id}&draft=1`}
                      prefetch={false}
                      className="drafts__op"
                    >
                      编辑
                    </Link>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      onClick={() => setDeleting({ collection: tab, id: row.id })}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
            <h3>确认删除</h3>
            <p>删除后不可恢复，确定删除这条草稿吗？</p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setDeleting(null)}>取消</button>
              <button type="button" className="drafts__op drafts__op--danger" onClick={() => void confirmDelete()}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DraftsViewInner