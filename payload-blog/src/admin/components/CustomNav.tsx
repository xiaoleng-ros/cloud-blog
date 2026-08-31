'use client'

/**
 * 自定义后台导航（仿 ThriveX-Admin 的「一级分组 + 二级菜单」结构）
 *
 * 功能说明：
 * - 左侧导航分为四个一级分组：总览 / 创作 / 管理 / 系统
 * - 每个分组下挂二级菜单项，点击跳转到 Payload 内置页面
 * - 分组可点击折叠/展开
 * - 底部保留「登出」按钮（复用 @payloadcms/ui 的 Logout 组件）
 *
 * 挂载方式：
 * - 通过 payload.config.ts 的 admin.components.nav 注册
 * - 复刻 Payload 默认 Nav 的 DOM 结构（aside.nav > div.nav__scroll > nav.nav__wrap），
 *   保证移动端汉堡开合逻辑与手账风主题样式继续生效
 */
import { Hamburger, Link, Logout, useConfig, useNav } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import React, { useMemo, useState } from 'react'

/** 四张云字图片标识 */
type CloudIconKey = 'blueIcon' | 'dark' | 'darkBg' | 'whiteOutline'

/** 云字图片路径（放在 public/cloud-icons/ 下，Next.js 可直接通过根路径引用） */
const cloudImages: Record<CloudIconKey, string> = {
  blueIcon: '/cloud-icons/cloud-dark.png',
  dark: '/cloud-icons/cloud-dark.png',
  darkBg: '/cloud-icons/cloud-dark.png',
  whiteOutline: '/cloud-icons/cloud-dark.png',
}

/** 二级菜单项配置 */
type NavItem = {
  /** 菜单文字 */
  label: string
  /** 目标路由（相对 admin 根路径，如 /collections/posts；'/' 表示仪表盘） */
  path: string
  /** 云字图标 */
  icon: CloudIconKey
}

/** 一级分组配置 */
type NavSection = {
  /** 分组标题 */
  label: string
  /** 分组标题前的小云图标 */
  icon: CloudIconKey
  /** 分组下的菜单项 */
  items: NavItem[]
}

/**
 * 菜单结构（对齐 ThriveX-Admin 的信息架构）：
 * 总览（仪表盘）｜ 创作（写文章/写随笔）｜ 管理（内容管理）｜ 系统（设置与账户）
 */
const sections: NavSection[] = [
  {
    label: '总览',
    icon: 'blueIcon',
    items: [{ label: '仪表盘', path: '/', icon: 'blueIcon' }],
  },
  {
    label: '创作',
    icon: 'dark',
    items: [
      { label: '写文章', path: '/write-post', icon: 'dark' },
      { label: '写随笔', path: '/write-note', icon: 'dark' },
      { label: '草稿箱', path: '/drafts', icon: 'dark' },
    ],
  },
  {
    label: '管理',
    icon: 'darkBg',
    items: [
      { label: '文章管理', path: '/collections/posts', icon: 'dark' },
      { label: '随笔管理', path: '/collections/notes', icon: 'dark' },
      { label: '分类管理', path: '/collections/categories', icon: 'dark' },
      { label: '标签管理', path: '/collections/tags', icon: 'dark' },
      { label: '图片管理', path: '/collections/media', icon: 'dark' },
      { label: '导航管理', path: '/globals/navigation', icon: 'dark' },
    ],
  },
  {
    label: '系统',
    icon: 'whiteOutline',
    items: [
      { label: '站点设置', path: '/globals/site-settings', icon: 'dark' },
      // 个人博客只有本账号，合并「用户管理」到「账号设置」一个入口
      { label: '账号设置', path: '/account', icon: 'dark' },
    ],
  },
]

/**
 * 云字图标组件
 * @param props.src 图片路径
 * @param props.className 额外类名
 */
const CloudIcon = ({ src, className }: { src: string; className?: string }) => (
  <img src={src} className={className || 'nav__link-icon'} alt="" aria-hidden="true" />
)

/**
 * 自定义导航组件
 * 说明：作为客户端组件由 RenderServerComponent 挂载，
 * 使用 useNav 控制 aside 开合，useConfig 读取 admin 根路由
 */
export const CustomNav = () => {
  // 导航开合状态（Payload 全局提供，移动端汉堡共享）
  const { navOpen, setNavOpen, navRef, hydrated, shouldAnimate } = useNav()
  // 读取 Payload 配置（拿 admin 根路由）
  const { config } = useConfig()
  // 当前页面路径（用于高亮当前菜单）
  const pathname = usePathname()
  // admin 根路由，如 /admin
  const adminRoute = config.routes.admin

  // 各分组的折叠状态（key 为分组名）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  /** 拼接完整路由：'/' -> /admin，'/collections/posts' -> /admin/collections/posts */
  const buildHref = (path: string) => (path === '/' ? adminRoute : `${adminRoute}${path}`)

  /**
   * 计算当前应高亮的菜单项
   * 规则：取「匹配且路径最长」的项，保证 /collections/posts/create 页面
   * 优先高亮「写文章」而不是「文章管理」
   */
  const activeHref = useMemo(() => {
    const matched = sections
      .flatMap((section) => section.items)
      .filter((item) => {
        const href = buildHref(item.path)
        // 仪表盘：仅根路径精确匹配
        if (item.path === '/') return pathname === adminRoute
        // 其余：精确匹配或「前缀 + 边界字符 /」匹配
        return pathname === href || (pathname.startsWith(href) && pathname[href.length] === '/')
      })
      .sort((a, b) => buildHref(b.path).length - buildHref(a.path).length)
    return matched[0] ? buildHref(matched[0].path) : ''
  }, [pathname, adminRoute])

  // aside 的 class 列表（与默认 NavWrapper 保持一致，主题样式可复用）
  const asideClasses = [
    'nav',
    navOpen && 'nav--nav-open',
    shouldAnimate && 'nav--nav-animate',
    hydrated && 'nav--nav-hydrated',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={asideClasses} inert={!navOpen ? true : undefined}>
      <div className="nav__scroll" ref={navRef}>
        <nav className="nav__wrap">
          {/* 品牌区：站点标识 */}
          <div className="nav__brand">
            <CloudIcon src={cloudImages.blueIcon} className="nav__brand-logo" />
            <span className="nav__brand-text">
              <span className="nav__brand-title">云上笔记</span>
              <span className="nav__brand-sub">Cloud Blog Admin</span>
            </span>
          </div>

          {/* 一级分组 + 二级菜单 */}
          {sections.map((section) => {
            const isCollapsed = collapsed[section.label]
            return (
              <div className={`nav-group${isCollapsed ? ' nav-group--collapsed' : ''}`} key={section.label}>
                {/* 分组标题（可点击折叠） */}
                <button
                  type="button"
                  className="nav-group__toggle"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [section.label]: !prev[section.label] }))}
                  tabIndex={navOpen ? 0 : -1}
                  aria-expanded={!isCollapsed}
                >
                  <span className="nav-group__title">
                    <CloudIcon src={cloudImages[section.icon]} className="nav-group__icon" />
                    <span className="nav-group__label">{section.label}</span>
                  </span>
                  <span className={`nav-group__chevron${isCollapsed ? ' nav-group__chevron--down' : ''}`} aria-hidden="true">
                    ▾
                  </span>
                </button>

                {/* 二级菜单项 */}
                {!isCollapsed && (
                  <div className="nav-group__content">
                    {section.items.map((item) => {
                      const href = buildHref(item.path)
                      const isActive = href === activeHref
                      return (
                        <Link
                          key={item.path}
                          href={href}
                          prefetch={false}
                          className={`nav__link${isActive ? ' nav__link--active' : ''}`}
                          id={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
                          tabIndex={navOpen ? 0 : -1}
                        >
                          {isActive && <span className="nav__link-indicator" />}
                          <CloudIcon src={cloudImages[item.icon]} />
                          <span className="nav__link-label">{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* 底部操作区：登出 */}
          <div className="nav__controls">
            <Logout tabIndex={navOpen ? 0 : -1} />
          </div>
        </nav>

        {/* 移动端关闭按钮（与默认 Nav 结构一致） */}
        <div className="nav__header">
          <div className="nav__header-content">
            <button
              className="nav__mobile-close"
              onClick={() => setNavOpen(false)}
              tabIndex={navOpen ? undefined : -1}
              type="button"
              aria-label="关闭菜单"
            >
              <Hamburger isActive />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
