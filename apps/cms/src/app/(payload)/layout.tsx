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
  <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default Layout