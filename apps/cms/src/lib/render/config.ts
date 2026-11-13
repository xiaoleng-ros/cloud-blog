/**
 * 渲染层配置：站点兜底值与同步快照类型
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { FriendEntry, MdEntry, ProjectEntry } from '../blog-sync'

export const SITE_DEFAULTS = {
  name: '云岫的博客',
  description: '记录 AI、代码、剪辑和生活观察。',
  url: process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://example.com',
  author: '小冷',
}

export const site = { ...SITE_DEFAULTS }

/**
 * 从 post 上取文章 URL 里的分类段（取第一个分类）。
 * 优先「分类标识」(slug) → `/posts/daily/46`；slug 为空时回退分类名。
 */

export interface SyncData {
  posts: MdEntry[]
  notes: MdEntry[]
  projects: ProjectEntry[]
  /** 友链（仅 status=published），/friends 页平铺展示，不分组 */
  friends: FriendEntry[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string; external?: boolean }>
  /** 「更多」下拉面板条目（后台「导航管理」→ 更多面板 Tab 配置） */
  morePanel: Array<{ href: string; label: string; icon?: string; external?: boolean }>
  /** Media 集合 url → alt 映射，用于正文图片 alt 补齐 */
  mediaAltMap: Map<string, string>
  version: string
}

/** 首页 */
