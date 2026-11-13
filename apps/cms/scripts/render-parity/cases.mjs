/**
 * 渲染对照用例集：给定一份同步快照，把每个页面的 blocks 渲染出来。
 *
 * 数据来自 `apps/blog/dev-fixtures/`（6 篇文章 + 5 篇随笔 + 项目列表），
 * 三套快照分别覆盖「数据齐全」「后台设置清空」「全空」三种边界，
 * 15 个路径 × 3 套 = 45 个用例，再加旧 URL 跳转与站内索引两组断言。
 *
 * 由 verify-render-parity.mjs 调用，不单独执行。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
// 快照注入点就是 loader 换上的那个桩模块（同一个 URL ⇒ 同一个模块实例）
import { __setSync } from './sync-stub.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const FIXTURES = join(REPO_ROOT, 'apps', 'blog', 'dev-fixtures')

function loadFixtures() {
  const posts = readdirSync(join(FIXTURES, 'posts'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, content } = matter(readFileSync(join(FIXTURES, 'posts', f), 'utf8'))
      return { id: f.replace(/\.md$/, ''), data, body: content, updatedAt: '2026-09-18T00:00:00Z' }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const notes = readdirSync(join(FIXTURES, 'notes'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, content } = matter(readFileSync(join(FIXTURES, 'notes', f), 'utf8'))
      return { id: f.replace(/\.md$/, '').split('-').pop(), data, body: content, updatedAt: '2026-09-28T00:00:00Z' }
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return { posts, notes }
}

// 站点设置写成单字段文本形态（换行分隔），与 Payload 后台的实际存储一致
const SETTINGS = {
  siteName: '云岫的博客',
  siteAuthor: '小冷',
  siteCreatedAt: '2024-05-01',
  siteIcp: '京ICP备 12345678 号',
  siteIcon: '',
  greeting: '你好，我是',
  name: '小冷',
  subtitle: '在深夜写代码，也在白天看云',
  bio: '这里记录 AI、代码、剪辑和生活观察。',
  socials: 'github https://github.com/xl\ntwitter https://twitter.com/xl\n某种平台 https://example.com/a',
  footerSubtitle: '用 Astro + Payload 搭的双应用博客。',
  footerChannels: 'GitHub https://github.com/xl\nRSS\n邮箱 mailto:a@b.c',
  footerGroups: '归档 /archive\n关于 /about\n友链 /friends',
  aboutParagraphs: '第一段关于我。\n\n第二段还在写。',
  notes:
    '[{"title":"持续学习","subtitle":"每周至少一篇","color":"cyan"},{"title":"动手优先","subtitle":"先跑起来再说","color":"pink"}]',
  skills:
    '[{"label":"前端","sublabel":"Astro / React","value":88,"color":"brand"},{"label":"后端","sublabel":"Node / Payload","value":72,"color":"cyan"},{"label":"剪辑","sublabel":"达芬奇","value":55,"color":"purple"}]',
  neteasePlaylistId: '1234567890',
}

const FRIENDS = [
  {
    id: '1',
    name: '星野',
    url: 'https://hoshino.example',
    description: '一个写 TypeScript 的',
    avatar: '',
    group: '好友',
    groupDescription: '一起写博客的人',
    sortOrder: 1,
  },
  { id: '2', name: '无头像的友链', url: 'https://noavatar.example', description: '', group: '好友', sortOrder: 2 },
]

const NAV = [
  { href: '/', label: '首页' },
  { href: '/archive', label: '归档' },
  { href: '/notes', label: '随笔' },
  { href: '/about', label: '关于' },
]

const MORE_PANEL = [
  { href: '/stats', label: '统计', icon: 'chart' },
  { href: '/friends', label: '友链', icon: 'heart' },
  { href: 'https://github.com/xl', label: 'GitHub', icon: 'github', external: true },
]

function makeSnapshots() {
  const { posts, notes } = loadFixtures()
  const projects = JSON.parse(readFileSync(join(FIXTURES, 'projects.json'), 'utf8'))
  const base = {
    posts,
    notes,
    projects,
    friends: FRIENDS,
    settings: { ...SETTINGS },
    nav: NAV,
    morePanel: MORE_PANEL,
    mediaAltMap: new Map([['https://cdn.example/a.png', '示意图']]),
    version: 'v1',
  }
  const noSettings = { ...base, settings: null, posts: [] }
  const emptyAll = {
    ...base,
    posts: [],
    notes: [],
    projects: [],
    friends: [],
    settings: {
      ...SETTINGS,
      socials: '',
      footerChannels: '',
      footerGroups: '',
      aboutParagraphs: '',
      notes: '',
      skills: '',
    },
    mediaAltMap: new Map(),
    version: 'v-empty',
  }
  return { base, noSettings, emptyAll }
}

const PATHS = [
  '/',
  '/notes/',
  '/archive/',
  '/archive/2/',
  '/about/',
  '/friends/',
  '/stats/',
  '/tags/',
  '/categories/',
  '/categories/' + encodeURIComponent('开发'),
  '/tags/' + encodeURIComponent('Astro'),
  '/posts/' + encodeURIComponent('开发') + '/9001/',
  '/posts/' + encodeURIComponent('开发') + '/9999/',
  '/archive/99/',
  '/unknown/',
]

const LEGACY_PATHS = ['/posts/9001', '/posts/开发/9001', '/posts/9999', '/about', '/stats', '/']

/**
 * 跑全部用例。
 * @param {{ renderBlocksForPathname: Function, resolveLegacyPostPath: Function, buildSiteIndex: Function }} mod
 */
export async function runCases(mod) {
  const { base, noSettings, emptyAll } = makeSnapshots()
  const cases = []
  for (const [label, snapshot] of [
    ['base', base],
    ['noSettings', noSettings],
    ['emptyAll', emptyAll],
  ]) {
    for (const path of PATHS) {
      __setSync(snapshot)
      try {
        const result = await mod.renderBlocksForPathname(path)
        const blocks = {}
        for (const key of Object.keys(result.blocks).sort()) blocks[key] = result.blocks[key]
        cases.push({
          label,
          path,
          ok: true,
          title: result.title,
          notFound: result.notFound,
          runtime: result.runtime,
          blocks,
        })
      } catch (error) {
        cases.push({ label, path, ok: false, error: String(error?.message ?? error) })
      }
    }
  }

  const legacy = []
  __setSync(base)
  for (const path of LEGACY_PATHS) legacy.push({ path, result: await mod.resolveLegacyPostPath(path) })

  const indexCtx = {
    posts: base.posts,
    notes: base.notes,
    projects: base.projects,
    settings: base.settings,
    nav: base.nav,
    morePanel: base.morePanel,
  }
  const index = mod.buildSiteIndex(indexCtx)
  const indexEmpty = mod.buildSiteIndex({ posts: [], notes: [], projects: [], settings: null, nav: [], morePanel: [] })

  return { cases, legacy, index, indexEmpty }
}
