/* 由 Payload 生成的后台根布局，不要手动修改被标注的区块 */
import config from '@payload-config'
import '@payloadcms/next/css'
import './admin-theme.css' // 组件层（蓝色系令牌 + Payload 控件与自定义视图样式）
import './admin-shell.css' // 壳子层（悬浮卡片侧栏 / 固定顶栏 / 多标签 / 暗色），需在后
import type { ServerFunctionClient } from 'payload'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import React from 'react'

import { importMap } from './admin/importMap.js'

type Args = {
  children: React.ReactNode
}

/**
 * 主题首屏脚本（同步阻塞内联，必须排在 children 之前）。
 *
 * 为什么要它：Payload 服务端 getRequestTheme 在无 cookie 时恒回落 light
 * （@payloadcms/next/dist/utilities/getRequestTheme.js），而 admin.theme='all' 时
 * 客户端 ThemeProvider 的 effect 会按 prefers-color-scheme 覆写 html[data-theme]
 * （@payloadcms/ui/dist/providers/Theme/index.js 的 getTheme：cookie → matchMedia）。
 * 于是 OS 深色首访必然「先亮后暗」闪一下。此脚本在首绘前按客户端终态同一顺序
 * （cookie `payload-theme` 命中 light/dark，否则 matchMedia 判 dark）提前写好 data-theme，
 * 让服务端 CSSOM 默认态 = 客户端终态。无外部依赖、整体 try/catch 兜底。
 */
const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var m=document.cookie.match(/(?:^|;)\\s*payload-theme=(light|dark)/);var t=m?m[1]:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.setAttribute('data-theme',t);}catch(e){}})();`

// 服务端函数桥接：连接后台 UI 与 Payload API
const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({
    ...args,
    config,
    importMap,
  })
}

const Layout = ({ children }: Args) => (
  <RootLayout
    // htmlProps 在 Payload 内部展开顺序晚于 suppressHydrationWarning，可覆盖之：
    // 否则 React 会把脚本提前写好的深色 data-theme 当 mismatch 修正回服务端 light，闪白照旧
    config={config}
    htmlProps={{ suppressHydrationWarning: true }}
    importMap={importMap}
    serverFunction={serverFunction}
  >
    <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
    {children}
  </RootLayout>
)

export default Layout