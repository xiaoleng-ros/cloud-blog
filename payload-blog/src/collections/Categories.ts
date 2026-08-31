import type { CollectionConfig } from 'payload'

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
      label: '分类标识（URL 用）',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}