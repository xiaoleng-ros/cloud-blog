'use client'

/**
 * 文章 / 随笔管理列表视图入口（挂载到 collection.admin.components.views.list）
 *
 * 替换 Payload 默认列表：整块内容由 ManageViewInner 自渲染，
 * 通过 clientProps.collectionSlug 区分文章 / 随笔两套配置。
 */
import type { ListViewClientProps } from 'payload'
import { ManageViewInner } from './ManageViewInner'

export function ManageListView({ collectionSlug }: ListViewClientProps) {
  const collection = collectionSlug === 'notes' ? 'notes' : 'posts'
  return <ManageViewInner collection={collection} />
}

export default ManageListView
