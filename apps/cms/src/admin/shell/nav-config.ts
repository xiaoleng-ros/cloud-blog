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
  | 'comments'
  | 'navigation'
  | 'settings'
  | 'changelog'
  | 'workbench'
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
  /**
   * 单条目分组压平成一级导航项：只渲染那条菜单本身，不显示分组标题与折叠箭头。
   * 「总览 → 仪表盘」用它 —— 仪表盘本来就是一级入口，再套一层折叠框纯属多余。
   * 约定：只有 items.length === 1 时才生效，多条目分组即使标了也按普通分组渲染。
   */
  standalone?: boolean
}

export const navSections: NavSection[] = [
  {
    label: '总览',
    standalone: true,
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
      { label: '评论管理', path: '/comments', icon: 'comments', keywords: 'comments reply pinglun shenhe' },
      { label: '导航管理', path: '/globals/navigation', icon: 'navigation', keywords: 'navigation daohang' },
    ],
  },
  {
    label: '系统',
    items: [
      // 工作台：集中展示待审 / 待处理事项，入口放在「系统」分组最上方
      { label: '工作台', path: '/workbench', icon: 'workbench', keywords: 'workbench gongzuotai daiban pending' },
      { label: '站点设置', path: '/globals/site-settings', icon: 'settings', keywords: 'settings site shezhi' },
      // 更新日志：GitHub 贡献热力图 + 三个仓库的近期提交（紧挨站点设置，同属「系统」）
      { label: '更新日志', path: '/changelog', icon: 'changelog', keywords: 'changelog update log git commit gengxin rizhi' },
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
