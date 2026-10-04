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
import { buildAdminHref, navSections, resolveNavEntry } from '../shell/nav-config'
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

export const CustomNav = () => {
  const { navOpen, setNavOpen, navRef, hydrated, shouldAnimate } = useNav()
  const { config } = useConfig()
  const pathname = usePathname()
  const adminRoute = config.routes.admin

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const wrapRef = useRef<HTMLElement>(null)

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

  // 当前应高亮的菜单项（与标签页共用同一套匹配规则）
  const activeItem = resolveNavEntry(pathname, adminRoute)
  const activeHref = activeItem ? buildAdminHref(activeItem.path, adminRoute) : ''

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
            const isCollapsed = collapsed[section.label]
            return (
              <div className={`nav-group${isCollapsed ? ' nav-group--collapsed' : ''}`} key={section.label}>
                <button
                  aria-expanded={!isCollapsed}
                  className="nav-group__toggle"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [section.label]: !prev[section.label] }))}
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

                {!isCollapsed && (
                  <div className="nav-group__content">
                    {section.items.map((item) => {
                      const href = buildAdminHref(item.path, adminRoute)
                      const isActive = href === activeHref
                      const isPending = pendingHref === href
                      return (
                        <Link
                          className={`nav__link${isActive ? ' nav__link--active' : ''}${isPending ? ' nav__link--pending' : ''}`}
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
                    })}
                  </div>
                )}
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

        {/* 首帧前定位：SSR HTML 里这段同步脚本在解析阶段就把 scrollTop 摆好，
            早于浏览器首次绘制，消除刷新时「先画顶部再跳下来」的一帧闪烁。
            SPA 重挂载不重跑此脚本，由上面的 useEffect 兜底。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=sessionStorage.getItem('admin-nav-scroll-top');if(t){var n=document.querySelector('.nav__wrap');if(n)n.scrollTop=parseInt(t,10)||0}}catch(e){}})();",
          }}
        />
      </div>
    </aside>
  )
}
