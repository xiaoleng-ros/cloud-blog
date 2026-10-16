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
 * 主题防闪的演进（2026-10-16 重写，旧注释描述的是已废弃的方案，勿再参考）：
 *
 * 旧方案：在 children 前渲染内联 <script> 同步写 html[data-theme]。
 * 为什么废弃（三条都有实证）：
 *   1. 它从未生效过。Payload 的 RootLayout 是客户端组件，本布局传给它的
 *      children（含该 script）会被序列化进 RSC flight 流，由客户端挂载——
 *      SSR HTML 里根本没有这个 script 实体标签（抓包确认：全文只有 3 个内联
 *      script，分别是 Next 启动器、flight 初始化与 flight 数据），浏览器解析
 *      阶段无从执行；客户端用 innerHTML 造出来的 script 同样不会执行。
 *      CDP 实测：模拟 prefers-color-scheme: dark 打开 /admin/login，
 *      data-theme 全程保持 SSR 默认的 light。
 *   2. 客户端挂载的 script 触发 React 19 dev 警告 "Encountered a script tag
 *      while rendering React component"（didWarnScriptTags，仅 dev 构建有），
 *      Next 16 dev 浮层会把它弹成错误。曾用 patches/next+16.3.8.patch 把
 *      react-dom 开发版的 didWarnScriptTags 初始值置 true 消音，2026-10-11
 *      已主动移除（patch-package 一旦因 Next 升级失配会让 npm ci 报错、中断
 *      部署流水线，收益却只是开发期一行警告），故警告回归。
 *   3. hidden-div + dangerouslySetInnerHTML 绕不过：React 19 Fizz 会在 SSR
 *      时剥掉内联 HTML 里的 script；type="module" 能消警告但脚本改为解析后
 *      才执行，失去「首绘前」的保证。
 *
 * 现方案（零脚本、零补丁）：Payload 的 getRequestTheme 会读请求头
 * `Sec-CH-Prefers-Color-Scheme`（@payloadcms/next/dist/utilities/
 * getRequestTheme.js：cookie → 该请求头 → 默认 light）。next.config.mjs 的
 * headers() 已对全站响应 `Accept-CH: Sec-CH-Prefers-Color-Scheme`：
 *   - 二次起访问：浏览器携带该头 → 服务端直接渲染正确主题，首帧即正确，
 *     无任何闪烁，也不需要 JS。
 *   - 首次访问（尚无 hint）：SSR 落 light，hydration 后 ThemeProvider 的
 *     effect 按 matchMedia 改写，与 Payload 原生行为一致，有一帧过渡。
 * 主题手动选择仍由 Payload 写 payload-theme cookie，优先级高于 hint，不受影响。
 */

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
    {children}
  </RootLayout>
)

export default Layout