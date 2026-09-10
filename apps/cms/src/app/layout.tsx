// Payload CMS 根布局：为 / 等非 payload 路由提供基础 HTML 框架
import React from 'react'

type Args = {
  children: React.ReactNode
}

export default function RootLayout({ children }: Args) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#0d1117', color: '#c9d1d9' }}>
        {children}
      </body>
    </html>
  )
}
