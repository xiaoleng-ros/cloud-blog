import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import { TrashViewInner } from './TrashViewInner'

/**
 * 回收站视图（挂载到 /admin/trash）
 *
 * 说明：自定义 Root View 不自动带后台布局，需嵌入 DefaultTemplate
 * （提供左侧导航栏 + 顶部栏 + 整体布局），再渲染回收站内容。
 */
export const TrashView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <TrashViewInner />
  </DefaultTemplate>
)
export default TrashView
