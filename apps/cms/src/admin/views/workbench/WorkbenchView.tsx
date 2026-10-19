import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'

import { WorkbenchViewInner } from './WorkbenchViewInner'

/**
 * 工作台视图（挂载到 /admin/workbench，侧栏「系统」分组首位）
 *
 * 版式对齐评论管理（CommentsView）：页头卡（右侧筛选胶囊）+
 * 「左列表卡 + 右详情卡」双栏，页面吃满视口、滚动只发生在左卡表格区。
 * 数据是一份统一的待处理队列：草稿文章 / 草稿随笔 / 待审评论汇成一张表。
 *
 * 与其它自定义 Root View 一样：自定义视图不带后台布局，必须嵌进 DefaultTemplate
 * 才能拿到左侧导航 + 顶栏 + 多标签壳。
 * ⚠️ 曾漏掉这层包装，结果工作台页整条左侧目录不渲染（shell-header 在、nav 不在），
 *    看起来就像"和别的页面不一样"——加自定义根视图时第一件事就是套模板。
 */
export const WorkbenchView = async ({ initPageResult, i18n, viewActions }: AdminViewServerProps) => (
  <DefaultTemplate
    payload={initPageResult.req.payload}
    req={initPageResult.req}
    i18n={i18n}
    permissions={initPageResult.permissions}
    visibleEntities={initPageResult.visibleEntities}
    viewActions={viewActions}
  >
    <WorkbenchViewInner />
  </DefaultTemplate>
)

export default WorkbenchView
