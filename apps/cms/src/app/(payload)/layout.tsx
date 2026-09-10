/* 由 Payload 生成的后台根布局，不要手动修改被标注的区块 */
import config from '@payload-config'
import '@payloadcms/next/css'
import './admin-theme.css' // 手账涂鸦风主题（配色对齐 cloud-blog 前台）
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