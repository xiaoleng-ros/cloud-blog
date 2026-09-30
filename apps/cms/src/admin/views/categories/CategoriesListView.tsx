'use client'

/**
 * 分类管理列表视图入口（挂载到 Categories 集合 admin.components.views.list）
 * 整块替换 Payload 默认列表，内容由 CategoriesViewInner 自渲染。
 */
import { CategoriesViewInner } from './CategoriesViewInner'

export function CategoriesListView() {
  return <CategoriesViewInner />
}

export default CategoriesListView
