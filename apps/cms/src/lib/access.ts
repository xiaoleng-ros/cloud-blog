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
 *   - 匿名 → 只能读到 published
 *   - CMS_DRAFT_PREVIEW=1 → 匿名也放开（仅用于本地排查线上渲染问题时临时开启）
 */
export const publishedOnlyForAnonymous: Access = ({ req }) => {
  if (req.user) return true
  if (process.env.CMS_DRAFT_PREVIEW === '1') return true
  return { status: { equals: 'published' } }
}
