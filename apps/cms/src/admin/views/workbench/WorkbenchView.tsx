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
            <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M20 45h80v55a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5V45Z"
                fill="var(--theme-elevation-100)"
              />
              <path
                d="M20 45l40-25 40 25"
                stroke="var(--theme-elevation-250)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="60" cy="70" r="12" fill="var(--accent-soft)" />
              <path
                d="M54 70c0 0 4 8 12 8M54 70c0 0 4-8 12-8"
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap="round"
              />
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
