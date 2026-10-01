import { APIError, type CollectionConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/** 从关系字段值里取 id（兼容 depth 展开后的对象与裸 id） */
const refId = (v: unknown): number | null => {
  if (v == null) return null
  if (typeof v === 'object') return Number((v as { id: unknown }).id) || null
  return Number(v) || null
}

/** 文章分类集合 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
    components: {
      // 定制树形管理页：图例/搜索/展开折叠 + 新建编辑弹窗
      views: {
        list: {
          Component: '/src/admin/views/categories/CategoriesListView.tsx#CategoriesListView',
        },
      },
    },
  },
  labels: {
    singular: '分类',
    plural: '分类',
  },
  access: {
    read: () => true, // 公开可读
  },
  hooks: {
    // 分类名直接决定文章 URL（/posts/{分类名}/{id}/），改名/删除都要让前台缓存与 SSE 失效，
    // 否则旧链接映射残留 → 死链（此前只有 Posts/Notes/Projects 挂了同步钩子）。
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
    beforeChange: [
      // 层级防环：上级不能是自己或自己的后代（弹窗会排除，但 API 直改也要拦）。
      async ({ data, originalDoc, req }) => {
        if (!data || data.parent === undefined) return data
        const pid = refId(data.parent)
        if (pid == null) return data
        const selfId = originalDoc?.id != null ? Number(originalDoc.id) : null
        let cursor: number | null = pid
        const seen = new Set<number>()
        while (cursor != null) {
          if (cursor === selfId) {
            // 必须显式传 400：Payload 对 500 状态的消息一律隐藏成 "Something went wrong."
            throw new APIError('上级分类不能选择自己或自己的子分类，会形成循环层级。', 400)
          }
          if (seen.has(cursor)) break
          seen.add(cursor)
          try {
            const up = await req.payload.findByID({
              collection: 'categories',
              id: cursor,
              depth: 0,
              req,
            })
            cursor = refId(up?.parent)
          } catch {
            cursor = null
          }
        }
        return data
      },
    ],
    beforeDelete: [
      // categories_id 在 posts/notes 上是 NOT NULL 列，而外键写的是 ON DELETE set null
      // （已在 20260926_000000_remove_posts_slug_add_categories 迁移与 schema 中核实：
      //   ADD COLUMN → 回填 → SET NOT NULL，FK 为 ON DELETE set null）。
      // 删除仍被引用的分类时 FK 试图把 NOT NULL 列置 NULL，直接撞约束 500。
      // 这里提前拦截并给出可读报错，把「数据库冲突」变成「后台可理解的提示」。
      //
      // 计数必须带 trash:true：回收站里的文章/随笔只是打了 deletedAt 标记，
      // 行还在、FK 也还在 —— 默认查询会把它们漏掉，导致「计数为 0 放行删除 → 撞约束」。
      // 含回收站后本钩子覆盖所有引用来源，SET NULL 分支不会再被触发，约束冲突即消除。
      async ({ id, req }) => {
        const children = await req.payload.count({
          collection: 'categories',
          where: { parent: { equals: id } },
          req,
        })
        if (children.totalDocs > 0) {
          throw new APIError(
            `该分类下还有 ${children.totalDocs} 个子分类，请先处理子分类的层级，再删除它。`,
            400,
          )
        }
        const posts = await req.payload.count({
          collection: 'posts',
          where: { categories: { equals: id } },
          trash: true,
          req,
        })
        const notes = await req.payload.count({
          collection: 'notes',
          where: { categories: { equals: id } },
          trash: true,
          req,
        })
        const inUse = posts.totalDocs + notes.totalDocs
        if (inUse > 0) {
          throw new APIError(
            `该分类已被 ${inUse} 篇内容引用（含回收站中的文章/随笔，它们仍占用该分类），请先彻底删除或移走这些内容，再删除这个分类。`,
            400,
          )
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: '分类名称',
    },
    {
      name: 'slug',
      type: 'text',
      label: '分类标识',
      admin: {
        position: 'sidebar',
        description: '仅用于导入脚本等内部标识；前台文章 URL 用的是「分类名称」，不是这一项。',
      },
    },
    {
      name: 'nodeType',
      type: 'select',
      required: true,
      defaultValue: 'category',
      label: '节点类型',
      options: [
        { label: '分类（归档文章）', value: 'category' },
        { label: '页面（站内页面）', value: 'page' },
        { label: '导航（外链跳转）', value: 'nav' },
      ],
      admin: {
        position: 'sidebar',
        description: '仅「分类」且前台可见的节点会出现在写文章/写随笔的分类下拉；页面/导航是层级标记，前台暂不消费。',
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      label: '上级分类',
      admin: { position: 'sidebar' },
      // 下拉里排除自己（后代由 beforeChange 防环钩子兜底）
      filterOptions: ({ id }) => (id ? { id: { not_equals: id } } : true),
    },
    {
      name: 'sort',
      type: 'number',
      defaultValue: 0,
      label: '排序权重',
      admin: { position: 'sidebar', description: '同级内数字越小越靠前' },
    },
    {
      name: 'visible',
      type: 'checkbox',
      defaultValue: true,
      label: '前台可见',
      admin: { position: 'sidebar' },
    },
  ],
}
