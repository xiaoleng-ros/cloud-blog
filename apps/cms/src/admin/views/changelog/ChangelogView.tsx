import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import { ChangelogViewInner } from './ChangelogViewInner'

/**
 * 更新日志视图（挂载到 /admin/changelog，侧栏「系统」分组、站点设置下方）
 *
 * 布局参考 ThriveX 的更新日志页：顶部页头（含年份选择）、GitHub 贡献热力图卡片、
 * 三个仓库的最近提交时间线卡片。数据来自同域 /api/changelog（服务端聚合 GitHub，
 * 前端用 sessionStorage 缓存，见 ChangelogViewInner 顶部注释）。
 *
 * 与其它自定义 Root View 一样：自定义视图不带后台布局，需嵌入 DefaultTemplate
 * 才能拿到左侧导航 + 顶栏 + 多标签壳。
 */
export const ChangelogView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <ChangelogViewInner />
  </DefaultTemplate>
)

export default ChangelogView
