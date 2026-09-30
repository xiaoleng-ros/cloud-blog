'use client'

/**
 * 标签管理列表视图入口（挂载到 Tags 集合 admin.components.views.list）
 * 整块替换 Payload 默认列表，内容由 TagsViewInner 自渲染。
 */
import { TagsViewInner } from './TagsViewInner'

export function TagsListView() {
  return <TagsViewInner />
}

export default TagsListView
