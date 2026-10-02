import React from 'react'

import type { ShellIconKey } from './nav-config'

/**
 * 壳子层图标：统一 24×24 线性图标，stroke 走 currentColor，
 * 因此侧边栏、标签条、命令面板与顶栏的图标颜色都跟着文字色变。
 */

type Props = {
  className?: string
  name: IconName
  size?: number
}

const paths: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  write: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14.5 5.5l4 4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8.5 9h7M8.5 13h5" />
    </>
  ),
  drafts: (
    <>
      <path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" />
      <path d="M5 4.5h14l1.5 9v5.5h-17V13.5z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4h6v2.5" />
      <path d="M6 6.5l1 14h10l1-14" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),
  posts: (
    <>
      <path d="M4 5h16M4 10h16M4 15h11M4 20h7" />
    </>
  ),
  notes: (
    <>
      <path d="M6 4.5h12v15H6z" />
      <path d="M9 9h6M9 13h4" />
    </>
  ),
  categories: (
    <>
      <path d="M3.5 6.5h6l2 2.5h9V19.5h-17z" />
      <path d="M3.5 6.5V4.5h5l1.5 2" />
    </>
  ),
  tags: (
    <>
      <path d="M4 4.5h8l7.5 7.5-8 8L4 12.5z" />
      <circle cx="8.5" cy="9" r="1.4" />
    </>
  ),
  media: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10.5" r="1.6" />
      <path d="M4.5 17.5l5-4.5 4 3.5 3-2.5 3.5 3" />
    </>
  ),
  navigation: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l4 4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  logout: (
    <>
      <path d="M14 4.5H6.5v15H14" />
      <path d="M11 12h9M17 8.5l3 3.5-3 3.5" />
    </>
  ),
  command: (
    <>
      <path d="M8 4.5h8M4.5 8v8M19.5 8v8M8 19.5h8" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5L11 13" />
      <path d="M18 14v5.5H4.5V6H10" />
    </>
  ),
}

export type IconName = ShellIconKey | 'search' | 'sun' | 'moon' | 'close' | 'chevronDown' | 'logout' | 'command' | 'external'

export const ShellIcon = ({ name, className, size = 18 }: Props) => (
  <svg
    aria-hidden="true"
    className={`shell-icon${className ? ` ${className}` : ''}`}
    fill="none"
    height={size}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    stroke="currentColor"
    viewBox="0 0 24 24"
    width={size}
  >
    {paths[name]}
  </svg>
)
