'use client'

/**
 * 侧栏底部用户卡：头像 + 昵称 + 邮箱，点击弹出菜单（目前只有「退出登录」）。
 * 取代原先孤零零一个 Logout 按钮；账号与站点设置已由侧栏导航直达，不再在这里重复入口。
 */
import { Link, useAuth, useConfig } from '@payloadcms/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ShellIcon } from './icons'

type MenuPosition = { bottom: number; left: number; width: number }

export const UserCard = () => {
  const { config } = useConfig()
  const { user } = useAuth()
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeMenu = useCallback(() => setMenuPos(null), [])

  useEffect(() => {
    if (!menuPos) return
    const onDocumentClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMenu, menuPos])

  if (!user) return null

  const adminRoute = config.routes.admin
  // 退出走 Payload 配置里的登出路由（默认 /logout），别写死
  const logoutHref = `${adminRoute}${config.admin.routes.logout}`
  const displayName = user.name || user.feishu?.name || user.email || '管理员'
  const initial = displayName.slice(0, 1).toUpperCase()
  const avatar = user.feishu?.avatar

  const toggle = () => {
    if (menuPos) {
      closeMenu()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left, width: rect.width })
  }

  return (
    <div className={`usercard${menuPos ? ' usercard--open' : ''}`} ref={containerRef}>
      <button
        aria-expanded={Boolean(menuPos)}
        className="usercard__trigger"
        onClick={toggle}
        ref={triggerRef}
        type="button"
      >
        <span className="usercard__avatar">
          {avatar ? <img alt="" src={avatar} /> : initial}
        </span>
        <span className="usercard__meta">
          <span className="usercard__name">{displayName}</span>
          <span className="usercard__sub">{user.email || '本地账号'}</span>
        </span>
        <ShellIcon className="usercard__chevron" name="chevronDown" size={14} />
      </button>

      {/* 侧栏卡片是 overflow:hidden + backdrop-filter，菜单留在里面会被裁掉且定位基准变形；挂到 body */}
      {menuPos &&
        createPortal(
          <div
            className="usercard__menu"
            style={{ bottom: menuPos.bottom, left: menuPos.left, width: menuPos.width }}
          >
            <Link className="usercard__item usercard__item--danger" href={logoutHref} prefetch={false}>
              <ShellIcon name="logout" size={15} />
              退出登录
            </Link>
          </div>,
          document.body,
        )}
    </div>
  )
}
