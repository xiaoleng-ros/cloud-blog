'use client'

/**
 * 全局命令面板（⌘K / Ctrl+K）：数据来自导航单一数据源，只做「跳转到后台页面」，
 * 不做内容搜索——正文检索在各列表视图里已有筛选器，这里重复实现只会拖慢唤起。
 */
import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ShellIcon } from './icons'
import { buildAdminHref, navSections, type NavItem, type ShellIconKey } from './nav-config'

type Props = {
  onClose: () => void
  open: boolean
}

type SearchableItem = NavItem & { group: string }

const allItems: SearchableItem[] = navSections.flatMap((section) =>
  section.items.map((item) => ({ ...item, group: section.label })),
)

export const CommandPalette = ({ onClose, open }: Props) => {
  const { config } = useConfig()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter((item) => `${item.label} ${item.path} ${item.keywords ?? ''}`.toLowerCase().includes(q))
  }, [query])

  const go = useCallback(
    (path: string) => {
      router.push(buildAdminHref(path, config.routes.admin))
      onClose()
    },
    [config.routes.admin, onClose, router],
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    // 面板挂载后再聚焦，避免首次渲染时 ref 还没就位
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((current) => Math.min(current + 1, results.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = results[cursor]
        if (item) go(item.path)
      }
    }
    // 用捕获阶段，防止 Payload 的快捷键先把方向键吃掉
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [cursor, go, onClose, open, results])

  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  return (
    <div
      className="palette"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="presentation"
    >
      <div className="palette__panel" onClick={(event) => event.stopPropagation()}>
        <div className="palette__search">
          <ShellIcon name="search" size={16} />
          <input
            aria-label="搜索后台页面"
            className="palette__input"
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            placeholder="搜索文章、随笔，或输入页面名称跳转"
            ref={inputRef}
            type="text"
            value={query}
          />
        </div>
        <ul className="palette__list">
          {results.length === 0 && <li className="palette__group">没有匹配的页面</li>}
          {results.map((item, index) => {
            const showGroup = index === 0 || results[index - 1].group !== item.group
            const isSelected = index === cursor
            return (
              <React.Fragment key={`${item.group}-${item.path}`}>
                {showGroup && <li className="palette__group">{item.group}</li>}
                <li
                  className={`palette__item${isSelected ? ' palette__item--selected' : ''}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item.path)}
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                >
                  <ShellIcon name={item.icon as ShellIconKey} size={17} />
                  {item.label}
                </li>
              </React.Fragment>
            )
          })}
        </ul>
        <div className="palette__hint">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>切换
          </span>
          <span>
            <kbd>↵</kbd>打开
          </span>
          <span>
            <kbd>Esc</kbd>关闭
          </span>
        </div>
      </div>
    </div>
  )
}
