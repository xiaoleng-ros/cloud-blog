'use client'

/**
 * 工作台视图：集中处理待审 / 待处理事项。
 *
 * 版式与标签管理 / 分类管理一致 —— 页头卡 + 「左目录、右详情」双栏：
 *   左栏列出全部待处理项（图标 / 名称 / 当前数量），点击切换右侧详情；
 *   右栏展示选中项的汇总数字、明细与跳转入口。
 * 这样工作台不是一张孤立的概览页，而是后台里一个普通的「列表 + 详情」页。
 *
 * 数据来源（Payload REST，同源相对路径，登录态由 cookie 会话兜住）：
 * - GET /api/posts?limit=1&depth=0&where[status][equals]=draft → totalDocs
 * - GET /api/notes?limit=1&depth=0&where[status][equals]=draft → totalDocs
 * - GET /api/comments?status=waiting&pageSize=1 → total
 * - GET /api/comments?status=all&pageSize=1      → total
 *
 * 计数一律用 limit=1 只读 totalDocs：limit=0 在 Payload REST 里是「取消上限、
 * 返回全表」，会把含正文的文档全部拉回来（同 DashboardView 的约定）。
 */
import { Link, useConfig } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { ShellIcon } from '../../shell/icons'
import { REQUEST_TIMEOUT_MS } from '../lib/api'

type ItemId = 'drafts' | 'waiting' | 'all'

type Counts = {
  drafts: number
  draftPosts: number
  draftNotes: number
  waitingComments: number
  totalComments: number
}

/** 待处理项的静态定义（顺序即左栏目录顺序） */
type WorkbenchItem = {
  id: ItemId
  label: string
  icon: 'posts' | 'comments' | 'note'
  /** 右栏标题下方的一句话说明 */
  desc: string
  count: number
  href: string
}

/** Payload REST 列表响应结构 */
type ListResponse = {
  docs: unknown[]
  totalDocs: number
}

/** 评论列表响应结构 */
type CommentsResponse = {
  total: number
}

export const WorkbenchView = () => {
  // 读取 admin 根路由用于拼接跳转链接
  const { config } = useConfig()
  const adminRoute = config.routes.admin

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [counts, setCounts] = useState<Counts>({
    drafts: 0,
    draftPosts: 0,
    draftNotes: 0,
    waitingComments: 0,
    totalComments: 0,
  })
  // 左栏当前选中项（默认落在数量最可能堆积的「草稿内容」上）
  const [activeId, setActiveId] = useState<ItemId>('drafts')

  useEffect(() => {
    const load = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const [postsRes, notesRes, waitingRes, allRes] = await Promise.all([
          fetch('/api/posts?limit=1&depth=0&where[status][equals]=draft', { signal: controller.signal }),
          fetch('/api/notes?limit=1&depth=0&where[status][equals]=draft', { signal: controller.signal }),
          fetch('/api/comments?status=waiting&pageSize=1', { signal: controller.signal }),
          fetch('/api/comments?status=all&pageSize=1', { signal: controller.signal }),
        ])

        const toJson = async <T,>(res: Response): Promise<T> => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return (await res.json()) as T
        }

        const [posts, notes, waiting, all] = await Promise.all([
          toJson<ListResponse>(postsRes),
          toJson<ListResponse>(notesRes),
          toJson<CommentsResponse>(waitingRes),
          toJson<CommentsResponse>(allRes),
        ])

        setCounts({
          draftPosts: posts.totalDocs,
          draftNotes: notes.totalDocs,
          drafts: posts.totalDocs + notes.totalDocs,
          waitingComments: waiting.total,
          totalComments: all.total,
        })
        setError(false)
      } catch {
        setError(true)
      } finally {
        clearTimeout(timer)
        setLoading(false)
      }
    }

    void load()
  }, [])

  const items: WorkbenchItem[] = [
    {
      id: 'drafts',
      label: '草稿内容',
      icon: 'posts',
      desc: '还没发布的文章与随笔',
      count: counts.drafts,
      href: `${adminRoute}/drafts`,
    },
    {
      id: 'waiting',
      label: '待审评论',
      icon: 'comments',
      desc: '读者留言，通过后才在前台显示',
      count: counts.waitingComments,
      href: `${adminRoute}/comments`,
    },
    {
      id: 'all',
      label: '全部留言',
      icon: 'note',
      desc: '站内全部评论记录（含已通过与垃圾）',
      count: counts.totalComments,
      href: `${adminRoute}/comments`,
    },
  ]

  const active = items.find((item) => item.id === activeId) ?? items[0]

  const rowCount = (item: WorkbenchItem) => {
    if (loading) return '…'
    if (error) return '—'
    return String(item.count)
  }

  return (
    <div className="workbench">
      <PageHeader
        title="工作台"
        actions={<span className="page-header__subtitle">集中处理待审核内容</span>}
      />

      <div className="workbench__layout">
        {/* 左：待处理目录 */}
        <section className="workbench__panel">
          <header className="workbench__panel-head">
            <h2 className="workbench__panel-title">
              待处理事项
              <span className="workbench__count">{items.length}</span>
            </h2>
          </header>

          <ul className="workbench__list">
            {items.map((item) => {
              const isActive = item.id === activeId
              return (
                <li key={item.id}>
                  <button
                    aria-current={isActive ? 'true' : undefined}
                    className={`workbench__row${isActive ? ' workbench__row--active' : ''}`}
                    onClick={() => setActiveId(item.id)}
                    type="button"
                  >
                    <span className="workbench__row-icon">
                      <ShellIcon name={item.icon} size={18} />
                    </span>
                    <span className="workbench__row-label">{item.label}</span>
                    <span className="workbench__row-count">{rowCount(item)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {/* 右：选中项详情 */}
        <aside className="workbench__side">
          <div className="workbench__side-head">
            <span className="workbench__side-icon">
              <ShellIcon name={active.icon} size={22} />
            </span>
            <div className="workbench__side-head-text">
              <h3>{active.label}</h3>
              <p>{active.desc}</p>
            </div>
          </div>

          {loading ? (
            <p className="drafts__empty">加载中…</p>
          ) : error ? (
            <p className="drafts__empty">加载失败，请刷新页面重试。</p>
          ) : active.count === 0 ? (
            <div className="workbench__side-empty">
              <span className="workbench__side-empty-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" />
                  <path d="M4 8l3-4h10l3 4M9.5 12.5h5" />
                </svg>
              </span>
              <p>空空如也</p>
            </div>
          ) : (
            <>
              <div className="workbench__side-value">
                {active.count}
                <span className="workbench__side-unit">条</span>
              </div>

              {active.id === 'drafts' && (
                <dl className="workbench__side-meta">
                  <div>
                    <dt>文章</dt>
                    <dd>{counts.draftPosts} 篇</dd>
                  </div>
                  <div>
                    <dt>随笔</dt>
                    <dd>{counts.draftNotes} 条</dd>
                  </div>
                </dl>
              )}
            </>
          )}

          <Link className="workbench__side-btn" href={active.href} prefetch={false}>
            去处理 →
          </Link>
        </aside>
      </div>
    </div>
  )
}
