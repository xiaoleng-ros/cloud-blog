'use client'

/**
 * 自定义仪表盘视图（仿 ThriveX-Admin 的数据概览页）
 *
 * 功能说明：
 * - 顶部展示五张统计便签卡片：文章 / 随笔 / 分类 / 标签 / 图片
 * - 中部左右两栏：最近文章 + 最近随笔
 * - 底部快捷操作：写文章 / 写随笔 / 站点设置
 *
 * 数据来源（Payload REST API，同源相对路径）：
 * - GET /api/posts?limit=0&depth=0            → 文章总数（totalDocs）
 * - GET /api/notes?limit=0&depth=0             → 随笔总数
 * - GET /api/categories?limit=0&depth=0        → 分类总数
 * - GET /api/tags?limit=0&depth=0              → 标签总数
 * - GET /api/media?limit=0&depth=0             → 图片总数
 * - GET /api/posts?sort=-date&limit=5&depth=0  → 最近文章
 * - GET /api/notes?sort=-date&limit=5&depth=0  → 最近随笔
 */
import { Link, useConfig } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

/** 统计卡片数据结构 */
type StatCard = {
  /** 卡片标题 */
  label: string
  /** 数量值 */
  value: number
  /** 单位文字 */
  unit: string
  /** 点击跳转的 admin 路径 */
  href: string
  /** 便签配色（对应主题 CSS 的四色便签） */
  color: 'yellow' | 'cyan' | 'pink' | 'purple' | 'green'
}

/** 最近文章行 */
type RecentPost = {
  id: number
  title?: string
  date?: string
  status?: string
}

/** 最近随笔行 */
type RecentNote = {
  id: number
  title?: string
  mood?: string
  date?: string
}

/** Payload REST 列表响应结构（仅取用到的字段） */
type ListResponse<T> = {
  docs: T[]
  totalDocs: number
}

/**
 * 格式化日期为中文短格式
 * @param value 日期字符串或 undefined
 * @returns 形如 2026-08-25 的字符串；无值时返回 '—'
 */
const formatDate = (value?: string) => {
  if (!value) return '—'
  const d = new Date(value)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 仪表盘组件（挂在 admin.components.views.dashboard） */
export const DashboardView = () => {
  // 读取 admin 根路由用于拼接跳转链接
  const { config } = useConfig()
  const adminRoute = config.routes.admin

  // 是否正在加载
  const [loading, setLoading] = useState(true)
  // 各集合总数
  const [stats, setStats] = useState<Record<string, number>>({})
  // 最近文章列表
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([])
  // 最近随笔列表
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([])

  useEffect(() => {
    /**
     * 并发拉取统计数据与最近内容
     * 说明：limit=0 表示不取文档只取 totalDocs；depth=0 不展开关联数据，减少响应体积
     */
    const load = async () => {
      try {
        const [
          postsRes,
          notesRes,
          catesRes,
          tagsRes,
          mediaRes,
          latestPostsRes,
          latestNotesRes,
        ] = await Promise.all([
          fetch('/api/posts?limit=0&depth=0'),
          fetch('/api/notes?limit=0&depth=0'),
          fetch('/api/categories?limit=0&depth=0'),
          fetch('/api/tags?limit=0&depth=0'),
          fetch('/api/media?limit=0&depth=0'),
          fetch('/api/posts?sort=-date&limit=5&depth=0'),
          fetch('/api/notes?sort=-date&limit=5&depth=0'),
        ])

        // 解析列表响应（失败时返回空对象，保持页面可用）
        const toJson = async <T,>(res: Response): Promise<ListResponse<T>> => {
          try {
            return (await res.json()) as ListResponse<T>
          } catch {
            return { docs: [], totalDocs: 0 }
          }
        }

        const [posts, notes, cates, tags, media, latestPosts, latestNotes] = await Promise.all([
          toJson<RecentPost>(postsRes),
          toJson<RecentNote>(notesRes),
          toJson<unknown>(catesRes),
          toJson<unknown>(tagsRes),
          toJson<unknown>(mediaRes),
          toJson<RecentPost>(latestPostsRes),
          toJson<RecentNote>(latestNotesRes),
        ])

        setStats({
          posts: posts.totalDocs,
          notes: notes.totalDocs,
          categories: cates.totalDocs,
          tags: tags.totalDocs,
          media: media.totalDocs,
        })
        setRecentPosts(latestPosts.docs)
        setRecentNotes(latestNotes.docs)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  // 统计卡片配置（颜色轮转，手账便签风）
  const statCards: StatCard[] = [
    { label: '文章', value: stats.posts ?? 0, unit: '篇', href: `${adminRoute}/collections/posts`, color: 'yellow' },
    { label: '随笔', value: stats.notes ?? 0, unit: '条', href: `${adminRoute}/collections/notes`, color: 'cyan' },
    { label: '分类', value: stats.categories ?? 0, unit: '个', href: `${adminRoute}/collections/categories`, color: 'pink' },
    { label: '标签', value: stats.tags ?? 0, unit: '个', href: `${adminRoute}/collections/tags`, color: 'purple' },
    { label: '图片', value: stats.media ?? 0, unit: '张', href: `${adminRoute}/collections/media`, color: 'green' },
  ]

  return (
    <div className="dashboard">
      {/* 页头 */}
      <header className="dashboard__header">
        <p className="dashboard__eyebrow">Dashboard</p>
        <h1 className="dashboard__title">数据概览</h1>
        <p className="dashboard__desc">站点内容一览，点击卡片可跳转对应管理页面。</p>
      </header>

      {/* 统计便签卡片 */}
      <section className="dashboard__stats" aria-label="内容统计">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href} prefetch={false} className={`dashboard__stat dashboard__stat--${card.color}`}>
            <span className="dashboard__stat-value">{loading ? '…' : card.value}</span>
            <span className="dashboard__stat-label">
              {card.label}（{card.unit}）
            </span>
          </Link>
        ))}
      </section>

      {/* 最近内容两栏 */}
      <section className="dashboard__grid">
        {/* 最近文章 */}
        <div className="dashboard__card">
          <div className="dashboard__card-head">
            <h2 className="dashboard__card-title">最近文章</h2>
            <Link href={`${adminRoute}/collections/posts`} prefetch={false} className="dashboard__card-more">
              查看全部 →
            </Link>
          </div>
          {loading ? (
            <p className="dashboard__empty">加载中…</p>
          ) : recentPosts.length === 0 ? (
            <p className="dashboard__empty">还没有文章，去创作第一篇吧！</p>
          ) : (
            <ul className="dashboard__list">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <Link href={`${adminRoute}/collections/posts/${post.id}`} prefetch={false} className="dashboard__list-row">
                    <span className="dashboard__list-title">{post.title || '（无标题）'}</span>
                    <span className="dashboard__list-date">{formatDate(post.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 最近随笔 */}
        <div className="dashboard__card">
          <div className="dashboard__card-head">
            <h2 className="dashboard__card-title">最近随笔</h2>
            <Link href={`${adminRoute}/collections/notes`} prefetch={false} className="dashboard__card-more">
              查看全部 →
            </Link>
          </div>
          {loading ? (
            <p className="dashboard__empty">加载中…</p>
          ) : recentNotes.length === 0 ? (
            <p className="dashboard__empty">还没有随笔，随手记一条？</p>
          ) : (
            <ul className="dashboard__list">
              {recentNotes.map((note) => (
                <li key={note.id}>
                  <Link href={`${adminRoute}/collections/notes/${note.id}`} prefetch={false} className="dashboard__list-row">
                    <span className="dashboard__list-title">{note.title || note.mood || formatDate(note.date)}</span>
                    <span className="dashboard__list-date">{formatDate(note.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 快捷操作 */}
      <section className="dashboard__actions" aria-label="快捷操作">
        <Link href={`${adminRoute}/write-post`} prefetch={false} className="dashboard__action dashboard__action--primary">
          ✍️ 写文章
        </Link>
        <Link href={`${adminRoute}/write-note`} prefetch={false} className="dashboard__action dashboard__action--yellow">
          ⚡ 写随笔
        </Link>
        <Link href={`${adminRoute}/globals/site-settings`} prefetch={false} className="dashboard__action dashboard__action--plain">
          ⚙️ 站点设置
        </Link>
      </section>
    </div>
  )
}
