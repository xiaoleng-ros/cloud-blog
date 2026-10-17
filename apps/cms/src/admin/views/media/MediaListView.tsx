'use client'

/**
 * 图片管理列表视图入口（挂载到 Media 集合 admin.components.views.list）
 * 整块替换 Payload 默认列表，内容由 MediaViewInner 自渲染。
 */
import { MediaViewInner } from './MediaViewInner'

export function MediaListView() {
  return <MediaViewInner />
}

export default MediaListView
