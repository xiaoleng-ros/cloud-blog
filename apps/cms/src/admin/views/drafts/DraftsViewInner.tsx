'use client'

/**
 * 草稿箱内容（client 组件，由 DraftsView server 包装渲染在 DefaultTemplate 布局内）
 *
 * 功能：
 * 1. 文章 / 随笔两个 Tab，各自分页列草案稿（GET /api/*?where[status][equals]=draft）
 * 2. 标题模糊搜索 + 创建时间日期范围过滤（与回收站同款工具栏）
 * 3. 「编辑」→ 跳转创作页回填（/admin/write-post?id=X&draft=1）
 * 4. 「删除」→ 软删除移入回收站（PATCH deletedAt）后刷新当前页
 *
 * 表格 / Tab / 分页 / 确认框复用 drafts__* 通用类，工具栏复用 trash__*；
 * 加载中仅刷新数据区，页头 / Tab / 工具栏骨架常驻。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useConfig } from '@payloadcms/ui'
import { PageHeader } from '../../components/PageHeader'
import { DateRangeField } from '../../components/DateField'
import { clip, extractNames, fmt, tagPill } from '../lib/format'
import { listDocs, trashDoc, type AdminNote, type AdminPost } from '../lib/api'

type Tab = 'posts' | 'notes'

/** 待删除确认信息 */
interface ConfirmState {
  collection: Tab
  id: number
}

/** 草稿行公共结构（文章/随笔归一化） */
interface DraftRow {
  id: number
  title: string
  excerpt: string
  categoryNames: string[]
  tagNames: string[]
  createdAt?: string
}

export const DraftsViewInner = () => {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  // Tab → 创作页视图路由前缀（posts → write-post；notes → write-note）
  const composePath: Record<Tab, string> = { posts: 'write-post', notes: 'write-note' }

  const [tab, setTab] = useState<Tab>('posts')
  const [titleInput, setTitleInput] = useState('')
  // 搜索防抖后的实际生效关键词
  const [keyword, setKeyword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<ConfirmState | null>(null)

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
      const and: Record<string, unknown>[] = [{ status: { equals: 'draft' } }]
      if (keyword) and.push({ title: { like: keyword } })
      if (from) and.push({ createdAt: { greater_than_equal: from } })
      if (to) and.push({ createdAt: { less_than_equal: to } })

      const res = await listDocs<AdminPost | AdminNote>(tab, { and }, page, 10, '-createdAt')
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
            createdAt: d.createdAt,
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

  // 页码 / Tab / 过滤条件变化时重新加载
  useEffect(() => {
    void load()
  }, [load])

  /** 切换 Tab 时重置页码与过滤条件 */
  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(1)
    setTitleInput('')
    setKeyword('')
    setFrom('')
    setTo('')
  }

  /** 确认移入回收站后刷新列表（软删除，可在回收站恢复） */
  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await trashDoc(deleting.collection, deleting.id)
      setDeleting(null)
      void load()
    } catch (error) {
      alert(`删除失败：${(error as Error).message}`)
      setDeleting(null)
    }
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 10)), [total])

  return (
    <div className="drafts">
      <PageHeader title="草稿箱" />

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

      {/* 工具栏：标题搜索 + 创建时间范围 */}
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
              <th>创建时间</th>
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
                  <td className="drafts__cell-date">{fmt(row.createdAt)}</td>
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
            <h3>确认删除</h3>
            <p>删除后可在「回收站」恢复，确定删除这条草稿吗？</p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setDeleting(null)}>取消</button>
              <button type="button" className="drafts__op drafts__op--danger" onClick={() => void confirmDelete()}>
                移入回收站
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DraftsViewInner
