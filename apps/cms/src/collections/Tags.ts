import type { CollectionConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

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
  hooks: {
    // 标签名同样出现在前台（/tags/{标签名}/ 与文章页标签链），改动需广播失效
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
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
      label: '标签标识',
      admin: {
        position: 'sidebar',
        description: '仅用于导入脚本等内部标识；前台标签页 URL 用的是「标签名称」，不是这一项。',
      },
    },
  ],
}