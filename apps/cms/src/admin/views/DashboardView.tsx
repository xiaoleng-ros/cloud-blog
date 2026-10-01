'use client'

/**
 * 自定义仪表盘视图（仿 ThriveX-Admin 的数据概览页）
 *
 * 功能说明：
 * - 顶部展示五张统计卡片：文章 / 随笔 / 分类 / 标签 / 图片
 * - 中部左右两栏：最近文章 + 最近随笔
 * - 底部快捷操作：写文章 / 写随笔 / 站点设置
 *
 * 数据来源（Payload REST API，同源相对路径）：
 * - 注意：Payload REST 的 limit=0 不是「只取总数」，而是「取消上限、返回全表」
 *   （见 db 适配层注释），会把所有文档（含正文）拉回来。统计卡片只需要 totalDocs，
 *   因此计数一律用 limit=1，只读 totalDocs，避免全表回传。
 * - GET /api/posts?limit=1&depth=0     → 文章总数（totalDocs）
 * - GET /api/notes?limit=1&depth=0     → 随笔总数
 * - GET /api/categories?limit=1&depth=0 → 分类总数
 * - GET /api/tags?limit=1&depth=0      → 标签总数
 * - GET /api/media?limit=1&depth=0     → 图片总数
 * - GET /api/posts?sort=-createdAt&limit=5&depth=0  → 最近文章（消费 docs）
 * - GET /api/notes?sort=-date&limit=5&depth=0       → 最近随笔（消费 docs）
 */
import { Link, useConfig } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'

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
  /** 卡片配色（对应主题 CSS 的 stat 变体） */
  color: 'yellow' | 'cyan' | 'pink' | 'purple' | 'green'
}

/** 最近文章行 */
type RecentPost = {
  id: number
  title?: string
  /** posts 集合没有 date 字段（见 collections/Posts.ts），排序与展示只能用 createdAt */
  createdAt?: string
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
  // 加载是否失败（未登录 / 5xx / 网络异常时展示错误占位，而非静默显示 0）
  const [error, setError] = useState(false)
  // 各集合总数
  const [stats, setStats] = useState<Record<string, number>>({})
  // 最近文章列表
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([])
  // 最近随笔列表
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([])

  useEffect(() => {
    /**
     * 并发拉取统计数据与最近内容
     * 说明：计数一律用 limit=1（只读 totalDocs，不消费 docs），limit=0 在 Payload REST 里
     *      是「取消上限、返回全表」而非「只取总数」，会把所有文档含正文拉回来；
     *      depth=0 不展开关联，进一步减小响应体积。
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
          fetch('/api/posts?limit=1&depth=0'),
          fetch('/api/notes?limit=1&depth=0'),
          fetch('/api/categories?limit=1&depth=0'),
          fetch('/api/tags?limit=1&depth=0'),
          fetch('/api/media?limit=1&depth=0'),
          fetch('/api/posts?sort=-createdAt&limit=5&depth=0'),
          fetch('/api/notes?sort=-date&limit=5&depth=0'),
        ])

        // 解析列表响应：非 2xx（未登录 401/403、服务端 5xx）时抛错，交由下方 catch 统一置错误态，
        // 不再静默回落到 0，避免「统计全 0」被误读成「还没有内容」。
        const toJson = async <T,>(res: Response): Promise<ListResponse<T>> => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return (await res.json()) as ListResponse<T>
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
        setError(false)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  // 统计卡片配置（颜色轮转）
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
      <PageHeader
        eyebrow="Dashboard"
        title="数据概览"
        desc="站点内容一览，点击卡片可跳转对应管理页面。"
      />

      {/* 统计卡片 */}
      <section className="dashboard__stats" aria-label="内容统计">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href} prefetch={false} className={`dashboard__stat dashboard__stat--${card.color}`}>
            <span className="dashboard__stat-value">
              {loading ? '…' : error ? '—' : card.value}
            </span>
            <span className="dashboard__stat-label">
              {error && !loading ? '加载失败' : `${card.label}（${card.unit}）`}
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
          ) : error ? (
            <p className="dashboard__empty">加载失败，请刷新页面重试。</p>
          ) : recentPosts.length === 0 ? (
            <p className="dashboard__empty">还没有文章，去创作第一篇吧！</p>
          ) : (
            <ul className="dashboard__list">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <Link href={`${adminRoute}/collections/posts/${post.id}`} prefetch={false} className="dashboard__list-row">
                    <span className="dashboard__list-title">{post.title || '（无标题）'}</span>
                    <span className="dashboard__list-date">{formatDate(post.createdAt)}</span>
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
          ) : error ? (
            <p className="dashboard__empty">加载失败，请刷新页面重试。</p>
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
