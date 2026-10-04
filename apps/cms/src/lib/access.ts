import type { Access, Where } from 'payload'

/**
 * 内容集合的读取访问控制工厂。
 *
 * 背景：整套集合曾统一写 `read: () => true`，等于把 Payload 的 access 能力当摆设 ——
 * `status: 'draft'` 的文章/随笔/项目可以被匿名直连 `/api/posts` 或 GraphQL 拉走全文，
 * 同步层（blog-sync.ts）的过滤只影响前台渲染，不影响 REST 出口。
 *
 * 规则：
 *   - 已登录（后台）→ 不受限，草稿照常可见可编辑
 *   - 匿名 → 只能读到 published，且（开了 trash 的集合）排除回收站（软删）文档
 *   - CMS_DRAFT_PREVIEW=1 → 匿名也放开（仅本地排查渲染问题；生产一律忽略）
 *
 * 为什么是工厂而不是直接读 `collection.trash`：access 函数收到的参数只有
 * `{ req, id?, data?, disableErrors? }`（见 payload/dist/collections/operations/find.js
 * 的 executeAccess 调用点，以及 payload/dist/config/types.d.ts 的 AccessArgs），
 * 没有 collection 配置 —— 写 `collection?.trash` 恒为 undefined，
 * 于是回收站排除条件从来没生效过。trash 是集合自己的事实，声明在调用处。
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

if (IS_PRODUCTION && process.env.CMS_DRAFT_PREVIEW === '1') {
  console.warn('[access] 生产环境忽略 CMS_DRAFT_PREVIEW=1，匿名草稿预览已禁用')
}

export const publishedOnlyForAnonymous =
  ({ trash }: { trash?: boolean } = {}): Access =>
  ({ req }) => {
    if (req.user) return true
    if (!IS_PRODUCTION && process.env.CMS_DRAFT_PREVIEW === '1') return true
    // 顶层多字段条件即 AND 组合（Payload where 语义），无需 and 数组
    const where: Where = { status: { equals: 'published' } }
    // deletedAt 只存在于开了 trash 的集合（posts/notes）；projects 没有该列，
    // 无条件带上会让 drizzle 抛 "Cannot find field for path at deletedAt" → 匿名 /api/projects 必 500
    // trash 软删除只是打 deletedAt 标记；匿名带 ?trash=true 能越过内置的默认过滤
    // 读回回收站全文，这里统一排除（exists:false 即 deletedAt IS NULL）
    if (trash) where.deletedAt = { exists: false }
    return where
  }
