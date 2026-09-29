import type { CollectionConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/** 文章分类集合 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
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
    beforeDelete: [
      // categories_id 在 posts/notes 上是 NOT NULL 列，而外键写的是 ON DELETE set null
      // （见 20260926 迁移）——删除仍被引用的分类会撞约束、直接 500。
      // 这里提前拦截并给出可读报错，把「数据库冲突」变成「后台可理解的提示」。
      async ({ id, req }) => {
        const posts = await req.payload.count({
          collection: 'posts',
          where: { categories: { equals: id } },
          req,
        })
        const notes = await req.payload.count({
          collection: 'notes',
          where: { categories: { equals: id } },
          req,
        })
        const inUse = posts.totalDocs + notes.totalDocs
        if (inUse > 0) {
          throw new Error(
            `该分类下还有 ${inUse} 篇内容，请先把它们移到其它分类，再删除这个分类。`,
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
  ],
}
