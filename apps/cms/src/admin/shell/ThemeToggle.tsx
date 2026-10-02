'use client'

/**
 * 明暗切换：滑块开关（亮色圆钮在左、内嵌太阳；暗色圆钮滑到右、内嵌月亮）。
 * 走 Payload 内置 ThemeProvider（cookie `payload-theme` + html[data-theme]）；
 * 首屏主题由 layout.tsx 的阻塞内联脚本按客户端终态（cookie → prefers-color-scheme）提前定稿，
 * 所以这里挂载后要读真实 DOM 的 data-theme，而不是直接信 provider 首帧的服务端回落值（恒 light）。
 */
import { useTheme } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { ShellIcon } from './icons'

export const ThemeToggle = () => {
  const { setTheme, theme } = useTheme()
  const [domDark, setDomDark] = useState<boolean | null>(null)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDomDark(el.getAttribute('data-theme') === 'dark')
    sync()
    // setTheme / ThemeProvider effect 都会同步写 html[data-theme]，观察它即可保持与终态一致
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const isDark = domDark ?? theme === 'dark'

  return (
    <button
      aria-checked={isDark}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      className="shell-themetoggle"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      role="switch"
      title={isDark ? '深色模式' : '浅色模式'}
      type="button"
    >
      <span className="shell-themetoggle__knob">
        <ShellIcon name={isDark ? 'moon' : 'sun'} size={12} />
      </span>
    </button>
  )
}
