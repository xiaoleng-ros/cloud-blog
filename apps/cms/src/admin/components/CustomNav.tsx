'use client'

/**
 * 自定义后台导航：分组 + 二级菜单 + 底部用户卡。
 *
 * 菜单数据来自 shell/nav-config.ts（单一数据源，顶栏标签与命令面板共用同一份）。
 * DOM 仍复刻 Payload 默认 Nav（aside.nav > div.nav__scroll > nav.nav__wrap），
 * 这样 Payload 的开合动画、grid 列宽（--nav-width）与移动端抽屉逻辑继续生效，
 * 悬浮卡片的外观完全由 admin-shell.css 在这几层上实现。
 */
import { Hamburger, Link, useConfig, useNav, useRouteTransition } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'

import { ShellIcon } from '../shell/icons'
import { buildAdminHref, navSections, resolveNavEntry, type NavItem } from '../shell/nav-config'
import { UserCard } from '../shell/UserCard'

/**
 * 侧栏滚动位置的持久化。
 * Payload 每次后台路由切换都会重渲染服务端模板，CustomNav 被整块重挂载，
 * DOM 上的 scrollTop 随之归零——于是点靠下的菜单后目录跳回顶部。
 * SPA 跳转靠模块变量兜住；整页刷新会重建 JS，再往 sessionStorage 镜像一份
 * （按标签页隔离、关标签自动清），刷新后目录停在原位置，不用重新往下找。
 */
const NAV_SCROLL_KEY = 'admin-nav-scroll-top'
let persistedScrollTop = 0

/**
 * 分组的默认开合状态。
 * 进后台最常见的事是写文章，所以默认只展开「总览」「创作」；
 * 「管理」「系统」收起，用的时候自己点开。
 *
 * 这个状态必须持久化：CustomNav 每次路由切换都会被整块重挂载（同上），
 * 只放 React state 的话，点开「管理」再点里面的菜单，导航一重挂载又被折回去了。
 * 存 sessionStorage：同一标签页内保持用户选择，关掉标签页下次回到默认。
 */
const NAV_COLLAPSED_KEY = 'admin-nav-collapsed'
const DEFAULT_COLLAPSED: Readonly<Record<string, boolean>> = { 管理: true, 系统: true }

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.sessionStorage.getItem(NAV_COLLAPSED_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, boolean> | null
      // 与默认值合并：以后新增分组时，老存储里没有它的键也能拿到正确默认值
      if (saved && typeof saved === 'object') return { ...DEFAULT_COLLAPSED, ...saved }
    }
  } catch {
    // 隐私模式 / 脏数据：回落默认
  }
  return { ...DEFAULT_COLLAPSED }
}

export const CustomNav = () => {
  const { navOpen, setNavOpen, navRef, hydrated, shouldAnimate } = useNav()
  const { config } = useConfig()
  const pathname = usePathname()
  const adminRoute = config.routes.admin

  // 初始值恒为默认折叠：服务端渲染拿不到 sessionStorage，若在这里读会 hydration 不一致
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_COLLAPSED }))
  const wrapRef = useRef<HTMLElement>(null)

  /** 切换分组开合，并记住用户的选择（重挂载后能恢复） */
  const toggleSection = (label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try {
        window.sessionStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // 存不进去不影响本次交互
      }
      return next
    })
  }

  /**
   * 点击后的等待指示。
   * 冷路径（该页还没进过缓存）要现场等一次后台模板的服务端渲染，旧界面在这一两秒里
   * 完全静止，容易被读成「点没点上」。命中缓存时 isTransitioning 一闪即过，指示器不出现。
   * CustomNav 在导航提交时才整块重挂载，等待期间本实例仍在，所以能靠局部状态显示。
   */
  const { isTransitioning } = useRouteTransition()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    if (!isTransitioning) setPendingHref(null)
  }, [isTransitioning])

  // 兜底：RouteTransition provider 缺席时 isTransitioning 恒为 false，靠路径变化收起指示
  useEffect(() => setPendingHref(null), [pathname])

  // 重挂载后把滚动位置写回去；此时目录项已同步渲染，可直接赋值
  useEffect(() => {
    const saved = window.sessionStorage.getItem(NAV_SCROLL_KEY)
    if (saved !== null) persistedScrollTop = Number(saved) || 0
    if (wrapRef.current) wrapRef.current.scrollTop = persistedScrollTop
  }, [])

  // 恢复用户上次的分组开合状态（放 effect 里：hydration 完成前不碰 DOM 结构，避免水合不一致）
  useEffect(() => {
    const saved = readCollapsed()
    setCollapsed((prev) => (JSON.stringify(prev) === JSON.stringify(saved) ? prev : saved))
  }, [])

  // 当前应高亮的菜单项（与标签页共用同一套匹配规则）
  const activeItem = resolveNavEntry(pathname, adminRoute)
  const activeHref = activeItem ? buildAdminHref(activeItem.path, adminRoute) : ''

  /**
   * 渲染一条菜单链接。
   * 一级项（仪表盘）与分组子项共用同一套 DOM 与激活态逻辑，
   * 靠 extraClass 区分缩进层级，避免两处各写一份。
   */
  const renderNavLink = (item: NavItem, extraClass = '') => {
    const href = buildAdminHref(item.path, adminRoute)
    const isActive = href === activeHref
    const isPending = pendingHref === href
    return (
      <Link
        className={`nav__link${extraClass}${isActive ? ' nav__link--active' : ''}${isPending ? ' nav__link--pending' : ''}`}
        href={href}
        id={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
        key={item.path}
        onClick={() => setPendingHref(href)}
        tabIndex={navOpen ? 0 : -1}
        // 悬停预取是「双开关」：next.config 的 experimental.dynamicOnHover 只把
        // process.env.__NEXT_DYNAMIC_ON_HOVER 烘进客户端包，真正把该链接的
        // fetchStrategy 升到 Full 要靠这个 per-link prop ——
        // next/dist/client/components/links.js:243 要求两者同时为真，缺一即空转。
        unstable_dynamicOnHover
      >
        {isActive && <span className="nav__link-indicator" />}
        <ShellIcon name={item.icon} size={16} />
        <span className="nav__link-label">{item.label}</span>
      </Link>
    )
  }

  const asideClasses = ['nav', navOpen && 'nav--nav-open', shouldAnimate && 'nav--nav-animate', hydrated && 'nav--nav-hydrated']
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={asideClasses} inert={!navOpen ? true : undefined}>
      <div className="nav__scroll" ref={navRef}>
        <nav
          className="nav__wrap"
          onScroll={(event) => {
            persistedScrollTop = event.currentTarget.scrollTop
            window.sessionStorage.setItem(NAV_SCROLL_KEY, String(persistedScrollTop))
          }}
          ref={wrapRef}
        >
          <div className="nav__brand">
            <img alt="" className="nav__brand-logo" src="/cloud-icons/cloud-dark.png" />
            <span className="nav__brand-text">
              <span className="nav__brand-title">云上笔记</span>
              <span className="nav__brand-sub">Cloud Blog Admin</span>
            </span>
          </div>

          {navSections.map((section) => {
            // 单条目分组（总览 → 仪表盘）：直接渲染成一级项，没有分组标题和折叠箭头
            if (section.standalone && section.items.length === 1) {
              return renderNavLink(section.items[0], ' nav__link--top')
            }

            const isCollapsed = collapsed[section.label]
            return (
              <div className={`nav-group${isCollapsed ? ' nav-group--collapsed' : ''}`} key={section.label}>
                <button
                  aria-expanded={!isCollapsed}
                  className="nav-group__toggle"
                  onClick={() => toggleSection(section.label)}
                  tabIndex={navOpen ? 0 : -1}
                  type="button"
                >
                  <span className="nav-group__title">
                    <span className="nav-group__label">{section.label}</span>
                  </span>
                  <span className={`nav-group__chevron${isCollapsed ? ' nav-group__chevron--down' : ''}`} aria-hidden="true">
                    ▾
                  </span>
                </button>

                {!isCollapsed && <div className="nav-group__content">{section.items.map((item) => renderNavLink(item))}</div>}
              </div>
            )
          })}

          <div className="nav__controls">
            <UserCard />
          </div>
        </nav>

        <div className="nav__header">
          <div className="nav__header-content">
            <button
              aria-label="关闭菜单"
              className="nav__mobile-close"
              onClick={() => setNavOpen(false)}
              tabIndex={navOpen ? undefined : -1}
              type="button"
            >
              <Hamburger isActive />
            </button>
          </div>
        </div>

        {/* 滚动恢复只靠上面的 useEffect：早先在这里放的内联 <script> 与主题脚本同病——
            Payload 后台的页面内容整体在 RSC flight 流里客户端挂载，SSR HTML 中不存在
            该 script 实体标签，永远不会执行，只会额外触发 React 19 dev 的
            "Encountered a script tag" 警告，2026-10-16 移除。整页刷新时恢复时机
            晚一帧（useEffect 在 hydration 后跑），可接受。 */}
      </div>
    </aside>
  )
}
