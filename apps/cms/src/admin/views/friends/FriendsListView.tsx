'use client'

/**
 * 友链管理列表视图入口（挂载到 Friends 集合 admin.components.views.list）
 * 整块替换 Payload 默认表格，内容由 FriendsViewInner 自渲染。
 */
import { FriendsViewInner } from './FriendsViewInner'

export function FriendsListView() {
  return <FriendsViewInner />
}

export default FriendsListView
