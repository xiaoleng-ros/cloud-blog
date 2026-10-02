import type { Access } from 'payload'

/**
 * 内容集合的读取访问控制。
 *
 * 背景：整套集合曾统一写 `read: () => true`，等于把 Payload 的 access 能力当摆设 ——
 * `status: 'draft'` 的文章/随笔/项目可以被匿名直连 `/api/posts` 或 GraphQL 拉走全文，
 * 同步层（blog-sync.ts）的过滤只影响前台渲染，不影响 REST 出口。
 *
 * 规则：
 *   - 已登录（后台）→ 不受限，草稿照常可见可编辑
 *   - 匿名 → 只能读到 published，且排除回收站（软删）文档
 *   - CMS_DRAFT_PREVIEW=1 → 匿名也放开（仅本地排查渲染问题；生产一律忽略）
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

if (IS_PRODUCTION && process.env.CMS_DRAFT_PREVIEW === '1') {
  console.warn('[access] 生产环境忽略 CMS_DRAFT_PREVIEW=1，匿名草稿预览已禁用')
}

export const publishedOnlyForAnonymous: Access = ({ req }) => {
  if (req.user) return true
  if (!IS_PRODUCTION && process.env.CMS_DRAFT_PREVIEW === '1') return true
  // 顶层多字段条件即 AND 组合（Payload where 语义），无需 and 数组
  return {
    status: { equals: 'published' },
    // trash 软删除只是打 deletedAt 标记；匿名带 ?trash=true 能越过内置的默认过滤
    // 读回回收站全文，这里统一排除（exists:false 即 deletedAt IS NULL，同 TrashView 的 exists:true 用法）
    deletedAt: { exists: false },
  }
}
