'use client'

/**
 * 自定义后台导航：分组 + 二级菜单 + 底部用户卡。
 *
 * 菜单数据来自 shell/nav-config.ts（单一数据源，顶栏标签与命令面板共用同一份）。
 * DOM 仍复刻 Payload 默认 Nav（aside.nav > div.nav__scroll > nav.nav__wrap），
 * 这样 Payload 的开合动画、grid 列宽（--nav-width）与移动端抽屉逻辑继续生效，
 * 悬浮卡片的外观完全由 admin-shell.css 在这几层上实现。
 */
import { Hamburger, Link, useConfig, useNav } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'

import { ShellIcon } from '../shell/icons'
import { buildAdminHref, navSections, resolveNavEntry } from '../shell/nav-config'
import { UserCard } from '../shell/UserCard'

export const CustomNav = () => {
  const { navOpen, setNavOpen, navRef, hydrated, shouldAnimate } = useNav()
  const { config } = useConfig()
  const pathname = usePathname()
  const adminRoute = config.routes.admin

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // 当前应高亮的菜单项（与标签页共用同一套匹配规则）
  const activeItem = resolveNavEntry(pathname, adminRoute)
  const activeHref = activeItem ? buildAdminHref(activeItem.path, adminRoute) : ''

  const asideClasses = ['nav', navOpen && 'nav--nav-open', shouldAnimate && 'nav--nav-animate', hydrated && 'nav--nav-hydrated']
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={asideClasses} inert={!navOpen ? true : undefined}>
      <div className="nav__scroll" ref={navRef}>
        <nav className="nav__wrap">
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
                      return (
                        <Link
                          className={`nav__link${isActive ? ' nav__link--active' : ''}`}
                          href={href}
                          id={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
                          key={item.path}
                          prefetch={false}
                          tabIndex={navOpen ? 0 : -1}
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
      </div>
    </aside>
  )
}
