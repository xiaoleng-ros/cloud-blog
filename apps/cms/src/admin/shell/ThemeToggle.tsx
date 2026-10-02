'use client'

/**
 * 明暗切换：滑块开关（亮色圆钮在左、内嵌太阳；暗色圆钮滑到右、内嵌月亮）。
 * 走 Payload 内置 ThemeProvider（cookie + html[data-theme]），首屏由服务端读 cookie 决定主题，不会闪一下白。
 */
import { useTheme } from '@payloadcms/ui'
import React from 'react'

import { ShellIcon } from './icons'

export const ThemeToggle = () => {
  const { setTheme, theme } = useTheme()
  const isDark = theme === 'dark'

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
