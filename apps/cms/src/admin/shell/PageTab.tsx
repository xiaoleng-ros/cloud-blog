'use client'

/**
 * 顶栏多标签条（浏览器式 Tab）：路径变化自动开标签，可关闭，右键出批量菜单。
 *
 * 标签以「导航项」为粒度而不是「文档」为粒度：/admin/collections/posts/<id> 归到「文章管理」这一张标签。
 * 与参考布局的前缀匹配语义一致，避免同集合的每篇文档都长出一张标签把条撑爆。
 */
import { Link, useConfig } from '@payloadcms/ui'
import { usePathname, useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { ShellIcon } from './icons'
import { buildAdminHref, resolveNavEntry } from './nav-config'
import {
  activateTab,
  closeAllTabs,
  closeOthers,
  closeTab,
  getServerSnapshot,
  getTabsSnapshot,
  hydrateTabs,
  openTab,
  subscribeTabs,
} from './tab-store'

type MenuState = { path: string; x: number; y: number }

export const PageTab = () => {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const pathname = usePathname()
  const router = useRouter()

  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const hydratedRef = useRef(false)
  const tabRefs = new Map<string, HTMLDivElement>()
  const listRef = useRef<HTMLDivElement | null>(null)

  const { tabs, active } = useSyncExternalStore(subscribeTabs, getTabsSnapshot, getServerSnapshot)

  // 先用 localStorage 里的标签恢复现场，再参与后续的「按路径开标签」
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const entry = resolveNavEntry(pathname, adminRoute)
    hydrateTabs({
      path: entry ? buildAdminHref(entry.path, adminRoute) : adminRoute,
      title: entry?.label ?? '仪表盘',
    })
    setReady(true)
  }, [adminRoute, hydratedRef, pathname])

  // 路由切换：命中导航项就开（或激活）对应标签
  useEffect(() => {
    if (!ready) return
    const entry = resolveNavEntry(pathname, adminRoute)
    if (!entry) return
    openTab({ path: buildAdminHref(entry.path, adminRoute), title: entry.label })
  }, [adminRoute, pathname, ready])

  // 激活标签滚入视口
  useEffect(() => {
    if (!active) return
    tabRefs.get(active)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [active])

  // 右键菜单的收起：点别处 / Esc / 滚动都关掉
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const navigateIfReturned = useCallback(
    (result: { navigateTo?: string }) => {
      if (result.navigateTo) router.push(result.navigateTo)
    },
    [router],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, path: string) => {
      event.preventDefault()
      event.stopPropagation()
      navigateIfReturned(closeTab(path))
    },
    [navigateIfReturned],
  )

  const renderMenuItem = (label: string, action: () => void) => (
    <button
      onClick={(event) => {
        event.stopPropagation()
        action()
        setMenu(null)
      }}
      type="button"
    >
      {label}
    </button>
  )

  return (
    <>
      <nav aria-label="已打开的页面" className="pagetab" ref={listRef}>
        {tabs.map((tab) => {
          const entry = resolveNavEntry(tab.path, adminRoute)
          const isActive = tab.path === active
          return (
            <div
              key={tab.path}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ path: tab.path, x: event.clientX, y: event.clientY })
              }}
              ref={(node) => {
                if (node) tabRefs.set(tab.path, node)
                else tabRefs.delete(tab.path)
              }}
              className={`pagetab__tab${isActive ? ' pagetab__tab--active' : ''}`}
            >
              <Link
                href={tab.path}
                onClick={() => activateTab(tab.path)}
                prefetch={false}
                style={{ display: 'contents' }}
              >
                {entry && <ShellIcon name={entry.icon} size={15} />}
                <span className="pagetab__label">{tab.title}</span>
              </Link>
              {tabs.length > 1 && (
                <button
                  aria-label={`关闭 ${tab.title}`}
                  className="pagetab__close"
                  onClick={(event) => handleClose(event, tab.path)}
                  type="button"
                >
                  <ShellIcon name="close" size={11} />
                </button>
              )}
            </div>
          )
        })}
      </nav>

      {/* 顶栏有 backdrop-filter，会把 fixed 后代的包含块变成顶栏自身；
          右键菜单挂到 body 才能用视口坐标定位 */}
      {menu &&
        createPortal(
          <div className="pagetab__menu" style={{ left: menu.x, top: menu.y }}>
            {renderMenuItem('关闭当前', () => navigateIfReturned(closeTab(menu.path)))}
            {renderMenuItem('关闭其他', () => navigateIfReturned(closeOthers(menu.path)))}
            {renderMenuItem('关闭全部', () => navigateIfReturned(closeAllTabs()))}
          </div>,
          document.body,
        )}
    </>
  )
}
