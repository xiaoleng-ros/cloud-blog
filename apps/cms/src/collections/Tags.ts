import type { CollectionConfig } from 'payload'

/** 文章标签集合 */
export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
  },
  labels: {
    singular: '标签',
    plural: '标签',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: '标签名称',
    },
    {
      name: 'slug',
      type: 'text',
      label: '标签标识（URL 用）',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}