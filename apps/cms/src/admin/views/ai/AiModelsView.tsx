import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'

import { AiModelsViewInner } from './AiModelsViewInner'

/**
 * AI 模型管理视图（挂载到 /admin/ai-models，侧栏「系统」分组）
 * 自定义根视图必须嵌进 DefaultTemplate 才能拿到侧边导航 + 顶栏 + 多标签壳。
 */
export const AiModelsView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <AiModelsViewInner />
  </DefaultTemplate>
)

export default AiModelsView
