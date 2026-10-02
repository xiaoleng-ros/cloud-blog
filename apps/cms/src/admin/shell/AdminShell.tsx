'use client'

/**
 * 全局壳子 provider：
 * - 用 Payload 内置 ThemeProvider 管理 html[data-theme]（cookie + 系统偏好）；
 *   首屏主题由 layout.tsx 里的阻塞内联脚本按客户端终态提前定稿，服务端回落 light 不再造成闪白
 * - 渲染固定顶栏（含多标签）与命令面板
 * - ⌘K / Ctrl+K 唤起命令面板
 * - 未登录（登录/登出/重置密码等页面 user 为空）时整套壳子不出现，登录页保持原样浅色
 */
import { useAuth, useConfig, useNav } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { CommandPalette } from './CommandPalette'
import { ShellIcon } from './icons'
import { PageTab } from './PageTab'
import { ThemeToggle } from './ThemeToggle'

type Props = {
  children?: React.ReactNode
}

const ShellHeader = () => {
  const { config } = useConfig()
  const { navOpen, setNavOpen } = useNav()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const adminRoute = config.routes.admin

  // 顶栏左边界要让位给侧栏卡片。CSS 里把「展开」当成默认态，这里只补收起态，
  // 否则首帧没有 data 属性、顶栏会先铺满整幅盖住侧栏（刷新时闪一下）。
  useEffect(() => {
    document.documentElement.dataset.shellNav = navOpen ? 'open' : 'closed'
  }, [navOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      {/* 顶栏所在的「壳子带」：必须与顶栏卡是兄弟节点（做成卡的伪元素会连卡片
          自己的背景一起盖掉），它压在顶栏卡下面、内容上面，把内容上滚时从卡片
          四周悬浮留白里穿出来的部分挡回去。 */}
      <div aria-hidden="true" className="shell-header__band" />

      <header className="shell-header">
        {/* 标签条必须是第一个 flex 项，它的左边缘才等于内容列卡片的左边缘；
            汉堡与品牌放在它后面，窄屏时不会把标签条往右推。 */}
        <PageTab />

        <a className="shell-header__brand" href={adminRoute}>
          <img alt="" src="/cloud-icons/cloud-dark.png" />
          <span>云上笔记</span>
        </a>

        <div className="shell-header__actions">
          <button className="shell-cmdentry" onClick={() => setPaletteOpen(true)} type="button">
            <ShellIcon name="search" size={14} />
            <span>搜索</span>
            <kbd>Ctrl K</kbd>
          </button>
          <ThemeToggle />
          <button
            aria-label={navOpen ? '收起导航' : '展开导航'}
            className="shell-header__burger"
            onClick={() => setNavOpen(!navOpen)}
            type="button"
          >
            <ShellIcon name="navigation" size={16} />
          </button>
        </div>
      </header>

      <CommandPalette onClose={() => setPaletteOpen(false)} open={paletteOpen} />
    </>
  )
}

export const AdminShell = ({ children }: Props) => {
  const { user } = useAuth()

  return (
    <>
      {user ? <ShellHeader /> : null}
      {children}
    </>
  )
}
