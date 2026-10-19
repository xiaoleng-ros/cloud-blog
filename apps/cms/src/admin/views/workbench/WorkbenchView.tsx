'use client'

/**
 * 工作台视图：集中展示需要管理员处理的待审 / 待处理事项。
 *
 * 数据来源：
 * - 草稿内容：GET /api/posts?where[status][equals]=draft&limit=1&depth=0 → totalDocs
 *             GET /api/notes?where[status][equals]=draft&limit=1&depth=0 → totalDocs
 * - 待审评论：GET /api/comments?status=waiting&pageSize=1 → total
 * - 全部留言：GET /api/comments?status=all&pageSize=1 → total
 *
 * 卡片可点击跳转到对应的管理入口。
 */
import { Link, useConfig } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { ShellIcon } from '../../shell/icons'
import { REQUEST_TIMEOUT_MS } from '../lib/api'

type Counts = {
  drafts: number
  draftPosts: number
  draftNotes: number
  waitingComments: number
  totalComments: number
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

  const formatValue = (value: number) => {
    if (loading) return '…'
    if (error) return '—'
    return String(value)
  }

  const hasNothing =
    !loading && !error && counts.drafts === 0 && counts.waitingComments === 0 && counts.totalComments === 0

  return (
    <div className="workbench">
      <PageHeader
        title="工作台"
        actions={<span className="page-header__subtitle">集中处理待审核内容</span>}
      />

      <section className="workbench__cards" aria-label="待处理事项">
        <Link
          className="workbench__card workbench__card--primary"
          href={`${adminRoute}/drafts`}
          prefetch={false}
        >
          <span className="workbench__card-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 13l4.5 4.5L19 7" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="workbench__card-icon">
            <ShellIcon name="posts" size={22} />
          </span>
          <div className="workbench__card-body">
            <div className="workbench__card-value">
              {formatValue(counts.drafts)}
              <span className="workbench__card-unit">条</span>
            </div>
            <div className="workbench__card-sublabel">
              文章 {loading || error ? '—' : counts.draftPosts} · 随笔{' '}
              {loading || error ? '—' : counts.draftNotes}
            </div>
          </div>
        </Link>

        <Link
          className="workbench__card"
          href={`${adminRoute}/comments`}
          prefetch={false}
        >
          <span className="workbench__card-icon">
            <ShellIcon name="comments" size={22} />
          </span>
          <div className="workbench__card-body">
            <div className="workbench__card-value">
              {formatValue(counts.waitingComments)}
              <span className="workbench__card-unit">条</span>
            </div>
            <div className="workbench__card-sublabel">待审评论</div>
          </div>
        </Link>

        <Link
          className="workbench__card"
          href={`${adminRoute}/comments`}
          prefetch={false}
        >
          <span className="workbench__card-icon">
            <ShellIcon name="comments" size={22} />
          </span>
          <div className="workbench__card-body">
            <div className="workbench__card-value">
              {formatValue(counts.totalComments)}
              <span className="workbench__card-unit">条</span>
            </div>
            <div className="workbench__card-sublabel">全部留言</div>
          </div>
        </Link>
      </section>

      {hasNothing && (
        <div className="workbench__empty">
          <div className="workbench__empty-art" aria-hidden="true">
            <svg viewBox="0 0 160 150" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* 底部阴影 */}
              <ellipse cx="80" cy="126" rx="52" ry="9" fill="var(--theme-elevation-100)" />
              {/* 箱子后盖 */}
              <path d="M38 62h84v52a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V62Z" fill="#cfe0f7" />
              {/* 箱内投下的暗面 */}
              <path d="M38 62h84v12H38z" fill="#b8d2f2" />
              {/* 打开的左右翼 */}
              <path d="M38 62 18 40l-4 44 24-6Z" fill="#e3effd" stroke="#cfe0f7" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M122 62l20-22 4 44-24-6Z" fill="#e3effd" stroke="#cfe0f7" strokeWidth="2.5" strokeLinejoin="round" />
              {/* 箱口前沿 */}
              <path
                d="M34 58h92v10a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V58Z"
                fill="#fff"
                stroke="#cfe0f7"
                strokeWidth="2.5"
              />
              {/* 飞出的星星 */}
              <path d="M70 26l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#3d82e8" />
              <path d="M104 20l2.2 5.8L112 28l-5.8 2.2L104 36l-2.2-5.8L96 28l5.8-2.2L104 20Z" fill="#7fb0f0" />
              <path d="M126 40l1.8 4.6 4.6 1.8-4.6 1.8L126 53l-1.8-4.8-4.6-1.8 4.6-1.8L126 40Z" fill="#a8cdf5" />
              {/* 上升的小点 */}
              <circle cx="52" cy="34" r="3" fill="#7fb0f0" />
              <circle cx="118" cy="60" r="2.6" fill="#a8cdf5" />
            </svg>
          </div>
          <p className="workbench__empty-text">空空如也</p>
        </div>
      )}

      {error && !loading && (
        <p className="workbench__error">加载失败，请刷新页面重试。</p>
      )}
    </div>
  )
}
