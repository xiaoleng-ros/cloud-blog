/**
 * 博客前台数据同步 —— 服务端渲染层（门面）
 *
 * 功能：把 Payload 最新数据渲染为与 Astro 静态构建**完全一致**的 HTML 区块。
 * 两个消费方：
 *   1. /api/blog-sync → 前台客户端轮询/SSE 后用 innerHTML 局部替换；
 *   2. [[...path]]/route.ts → 响应 HTML 前直接注入，保证首屏就是最新数据（不闪烁）。
 *
 * 拆分说明：具体区块渲染在 ./render/ 下按页面分文件，这里只做「按路径分发」。
 * 拆分只为可读性，输出必须与拆分前逐字相同（见 apps/cms/scripts/verify-render-parity.mjs）。
 *
 * ⚠️ 区块约定：**每个区块返回的都是锚点元素的 innerHTML**，
 *    即 <div class="hero__card" data-sync-block="heroCard">…这里…</div>
 *    渲染函数不再自带这一层容器，否则每同步一次就会多套一层同名容器（双层内边距/边框）。
 *    内层结构与对应 *.astro 模板保持一致，class 名一致以保证样式不变。
 */

import { getSyncData } from './blog-sync'
import { getBlock, setBlock } from './sync-cache'
export { buildSiteIndex } from './render/site-index'
import { getCategories, getTags, getArchiveTotalPages, parseArchivePage } from 'cloud-blog/shared/post-utils'
import { aboutBlocks } from './render/blocks-about'
import { archiveBlocks } from './render/blocks-archive'
import { friendsBlocks } from './render/blocks-friends'
import { homeBlocks } from './render/blocks-home'
import { notesBlocks } from './render/blocks-notes'
import { postBlocks } from './render/blocks-post'
import { statsBlocks } from './render/blocks-stats'
import { tagsIndexBlocks, termBlocks } from './render/blocks-term'
import type { SyncData } from './render/config'
import { site } from './render/config'
import { avatarOf } from './render/site-settings'
import { getPostPath } from './render/util'

export async function resolveLegacyPostPath(pathname: string): Promise<string | null> {
  const legacy = /^\/posts\/([^/]+)\/?$/.exec(pathname)
  const current = /^\/posts\/([^/]+)\/([^/]+)\/?$/.exec(pathname)
  if (!legacy && !current) return null

  // 段是 URL 编码的；decodeURIComponent 对畸形输入会抛，交给调用方的 try/catch 兜底
  const decode = (value: string | undefined) => decodeURIComponent(value ?? '')
  const id = legacy ? decode(legacy[1]) : decode(current?.[2])
  // 文章 ID 必为数字；分类段是文本，所以两种形态都能靠 ID 段识别
  if (!/^\d+$/.test(id)) return null

  const snapshot = await getSyncData()
  const post = snapshot.posts.find((entry) => String(entry.id) === id)
  if (!post) return null

  const canonical = getPostPath(post)
  // 已经是规范形态就返回 null，避免自我 301 死循环
  if (current) {
    const segment = parsePostSegment(canonical)
    if (decode(current[1]) === segment) return null
  }
  return canonical
}

/** 从规范文章路径 /posts/{segment}/{id} 里取出分类段 */

export function parsePostSegment(canonical: string): string {
  return decodeURIComponent(canonical.split('/')[2] ?? '')
}

// ---------------------------------------------------------------------------
// 站内搜索索引（/site-index.json）：与前台 Astro 端点（apps/blog/src/lib/site-index.ts）同口径。
// 9527/线上由 CMS 动态生成 —— 新发的文章立刻能搜到，不再依赖外壳重建。
// ---------------------------------------------------------------------------

export async function renderBlocksForPathname(pathname: string): Promise<{
  version: string
  title: string | null
  blocks: Record<string, string | null>
  /** 数据层不存在该页面（文章/分类/标签/归档页码）：外壳缺失的模板兜底据此改判 404 */
  notFound: boolean
  /**
   * 非 DOM 区块的运行时值（页面脚本按需应用，见 BaseLayout 的 applyRuntime）：
   * - icon：站点图标地址（favicon / apple-touch，与页脚头像同一条兜底）
   * - playlist：后台歌单 ID 的「已校验」值；null = 后台留空（前台退回构建期兜底/env），
   *   '' = 明确失效（应隐藏播放器）。非法值不回退 env，与 MusicPlayer 构建期口径一致。
   * 与区块缓存同版本键控：version 变化才重新计算，缓存命中时按同一快照现算（开销可忽略）。
   */
  runtime: { icon: string; playlist: string | null }
}> {
  const snapshot = await getSyncData()
  const version = snapshot.version

  const playlistRaw = String(snapshot.settings?.neteasePlaylistId ?? '').trim()
  const runtime = {
    icon: avatarOf(snapshot.settings),
    playlist: /^\d+$/.test(playlistRaw) ? playlistRaw : playlistRaw ? '' : null,
  }

  // 路径归一化：/about 与 /about/ 视为同一份缓存（服务端注入与前台轮询拿到的 URL 形式可能不同）
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`

  // 命中区块缓存：版本号一致 → 直接返回，零查库、零渲染（~1ms）
  const cached = getBlock(path)
  if (cached && cached.version === version) {
    return { version, title: cached.title, blocks: cached.blocks, notFound: cached.notFound ?? false, runtime }
  }

  const ctx: SyncData = {
    posts: snapshot.posts,
    notes: snapshot.notes,
    projects: snapshot.projects,
    friends: snapshot.friends,
    settings: snapshot.settings,
    nav: snapshot.nav,
    morePanel: snapshot.morePanel,
    mediaAltMap: snapshot.mediaAltMap,
    version,
  }
  const siteName = snapshot.settings?.siteName ?? site.name

  let title: string | null = siteName
  let blocks: Record<string, string | null>
  let notFound = false

  if (path === '/') {
    blocks = await homeBlocks(ctx)
    title = siteName
  } else if (path.startsWith('/posts/')) {
    blocks = await postBlocks(ctx, path)
    title = (blocks.pageTitle as string) ?? siteName
    // postBlocks 查无文章时只返回 { postContent: null }
    notFound = Object.keys(blocks).length === 1 && blocks.postContent === null
  } else if (path === '/notes/') {
    blocks = await notesBlocks(ctx)
    title = `随笔 - ${siteName}`
  } else if (path === '/archive/' || /^\/archive\/\d+\/$/.test(path)) {
    // 归档已分页：/archive/、/archive/2/ … 都要按 path 里的页码切出对应那页
    blocks = await archiveBlocks(ctx, path)
    const page = parseArchivePage(path)
    title = page > 1 ? `归档 - 第 ${page} 页 - ${siteName}` : `归档 - ${siteName}`
    notFound = page < 1 || page > getArchiveTotalPages(ctx.posts.length)
  } else if (path === '/about/') {
    blocks = await aboutBlocks(ctx)
    title = `关于 - ${siteName}`
  } else if (path === '/friends/') {
    blocks = await friendsBlocks(ctx)
    title = `友链 - ${siteName}`
  } else if (path === '/stats/') {
    blocks = await statsBlocks(ctx)
    title = `数据统计 - ${siteName}`
  } else if (path === '/tags/') {
    // 必须排在 startsWith('/tags/') 之前：否则标签墙页会落进「标签词条页」的分支
    blocks = await tagsIndexBlocks(ctx)
    title = `标签 - ${siteName}`
  } else if (path.startsWith('/categories/')) {
    const term = decodeURIComponent(path.split('/')[2] ?? '')
    blocks = await termBlocks(ctx, path, 'categories')
    title = `分类 - ${siteName}`
    notFound = !getCategories(ctx.posts).some((t) => t.name === term)
  } else if (path.startsWith('/tags/')) {
    const term = decodeURIComponent(path.split('/')[2] ?? '')
    blocks = await termBlocks(ctx, path, 'tags')
    title = `标签 - ${siteName}`
    notFound = !getTags(ctx.posts).some((t) => t.name === term)
  } else {
    blocks = {}
    title = siteName
  }

  setBlock(path, { version, title, blocks, notFound, ts: Date.now() })
  return { version, title, blocks, notFound, runtime }
}
