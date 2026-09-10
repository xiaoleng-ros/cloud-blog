import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import { ComposeView } from './ComposeView'

/**
 * 写文章视图（挂载到 /admin/write-post）
 *
 * 说明：自定义 Root View 不自动带后台布局，需嵌入 DefaultTemplate
 * （提供左侧导航栏 + 顶部栏 + 整体布局），再渲染业务内容。
 */
export const PostComposeView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <ComposeView collection="posts" title="写文章" />
  </DefaultTemplate>
)
export default PostComposeView