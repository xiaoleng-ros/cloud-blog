'use client'

/**
 * Payload 全局图形组件替换
 * - Logo：用于登录页、创建首个用户页等品牌位置
 *
 * 四张云字图均保存在 public/cloud-icons/，通过根路径引用。
 */
import React from 'react'

/** 品牌 Logo（登录页、创建首个用户页） */
export const CloudLogo = () => (
  <img
    src="/cloud-icons/cloud-dark.png"
    alt="云上笔记"
    className="cloud-logo"
    style={{
      display: 'block',
      height: '3rem',
      width: 'auto',
    }}
  />
)
