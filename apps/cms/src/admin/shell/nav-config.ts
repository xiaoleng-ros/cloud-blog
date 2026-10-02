/**
 * 后台导航的单一数据源：分组 → 菜单项。
 * 侧边栏（CustomNav）、顶栏标签（PageTab）、命令面板（CommandPalette）三处共用这份配置，
 * 新增页面只需在这里加一行，三个消费方自动同步。
 */

export type ShellIconKey =
  | 'dashboard'
  | 'write'
  | 'note'
  | 'drafts'
  | 'trash'
  | 'posts'
  | 'notes'
  | 'categories'
  | 'tags'
  | 'media'
  | 'navigation'
  | 'settings'
  | 'account'

export type NavItem = {
  label: string
  /** 相对 admin 根路由：'/' 仪表盘，'/collections/posts' 内置列表，'/globals/site-settings' 单例 */
  path: string
  icon: ShellIconKey
  /** 中文检索词（命令面板按拼音/英文关键词也能命中） */
  keywords?: string
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: '总览',
    items: [{ label: '仪表盘', path: '/', icon: 'dashboard', keywords: 'dashboard home shouye' }],
  },
  {
    label: '创作',
    items: [
      { label: '写文章', path: '/write-post', icon: 'write', keywords: 'compose post xie wenzhang' },
      { label: '写随笔', path: '/write-note', icon: 'note', keywords: 'compose note suibi' },
      { label: '草稿箱', path: '/drafts', icon: 'drafts', keywords: 'draft caogao' },
      { label: '回收站', path: '/trash', icon: 'trash', keywords: 'trash recycle shanchu' },
    ],
  },
  {
    label: '管理',
    items: [
      { label: '文章管理', path: '/collections/posts', icon: 'posts', keywords: 'posts list wenzhang' },
      { label: '随笔管理', path: '/collections/notes', icon: 'notes', keywords: 'notes list suibi' },
      { label: '分类管理', path: '/collections/categories', icon: 'categories', keywords: 'categories fenlei' },
      { label: '标签管理', path: '/collections/tags', icon: 'tags', keywords: 'tags biaoqian' },
      { label: '图片管理', path: '/collections/media', icon: 'media', keywords: 'media image tupian' },
      { label: '导航管理', path: '/globals/navigation', icon: 'navigation', keywords: 'navigation daohang' },
    ],
  },
  {
    label: '系统',
    items: [
      { label: '站点设置', path: '/globals/site-settings', icon: 'settings', keywords: 'settings site shezhi' },
      { label: '账号设置', path: '/account', icon: 'account', keywords: 'account profile zhanghao' },
    ],
  },
]

/** 摊平成「path → 菜单项」的有序列表，供标签页与命令面板消费 */
export const flatNavItems: NavItem[] = navSections.flatMap((section) => section.items)

/** 拼出完整后台 URL：'/' -> /admin，'/collections/posts' -> /admin/collections/posts */
export const buildAdminHref = (path: string, adminRoute: string) =>
  path === '/' ? adminRoute : `${adminRoute}${path}`

/**
 * 路径反查菜单项。
 * 规则与侧边栏一致：仪表盘只精确匹配；其余按「前缀 + / 边界」匹配并取最长，
 * 于是 /collections/posts/<id> 归到「文章管理」，而 /collections/posts/create 也仍在「文章管理」下
 * （写文章是独立路由 /write-post，不会被误判）。
 */
export const resolveNavEntry = (pathname: string, adminRoute: string): NavItem | undefined => {
  const matched = flatNavItems
    .filter((item) => {
      const href = buildAdminHref(item.path, adminRoute)
      if (item.path === '/') return pathname === adminRoute
      return pathname === href || (pathname.startsWith(href) && pathname[href.length] === '/')
    })
    .sort((a, b) => buildAdminHref(b.path, adminRoute).length - buildAdminHref(a.path, adminRoute).length)

  return matched[0]
}
