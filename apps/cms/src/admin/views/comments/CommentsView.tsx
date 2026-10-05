import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import { CommentsViewInner } from './CommentsViewInner'

/**
 * 评论管理视图（挂载到 /admin/comments）
 *
 * 说明：自定义 Root View 不自动带后台布局，需嵌入 DefaultTemplate
 * （提供左侧导航栏 + 顶部栏 + 整体布局），再渲染评论列表。
 */
export const CommentsView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <CommentsViewInner />
  </DefaultTemplate>
)
export default CommentsView
