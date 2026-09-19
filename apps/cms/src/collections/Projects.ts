import type { CollectionConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/**
 * 关于页项目集合
 *
 * 把原先写死在前台 site.config.json / github-projects.json 的项目卡片
 * 全部收纳进数据库，后台可随时增删改。关于页「项目区」全部从这里读取。
 * 每条项目归属某个分组（group），前台按 group 聚合展示。
 */
export const Projects: CollectionConfig = {
  slug: 'projects',
  // 列表默认按 group 排序（defaultSort 属于 CollectionConfig 顶层，不在 admin 下）
  defaultSort: 'group',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'group', 'sortOrder', 'status', 'updatedAt'],
  },
  labels: {
    singular: '项目',
    plural: '项目',
  },
  access: {
    read: () => true,
  },
  hooks: {
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
  },
  fields: [
    {
      name: 'group',
      type: 'text',
      required: true,
      label: '分组名称',
      admin: {
        description: '同一分组会聚合成一个区块，如「开源项目」「资源下载」。',
      },
    },
    {
      name: 'groupDescription',
      type: 'textarea',
      label: '分组描述',
      admin: { description: '显示在分组标题下方，可留空。同一分组取第一条。' },
    },
    { name: 'title', type: 'text', required: true, label: '项目名称' },
    { name: 'owner', type: 'text', label: '所有者' },
    { name: 'description', type: 'textarea', label: '项目描述' },
    {
      name: 'icon',
      type: 'text',
      label: '图标名',
      defaultValue: 'github',
      admin: {
        description: '与前台 Icon 组件一致的图标名，如 github / download / globe / wechat。',
      },
    },
    { name: 'href', type: 'text', label: '链接 URL' },
    { name: 'articleHref', type: 'text', label: '相关文章链接', admin: { position: 'sidebar' } },
    { name: 'stars', type: 'number', label: 'Star 数', admin: { position: 'sidebar' } },
    {
      name: 'tags',
      type: 'textarea',
      label: '标签',
      admin: { description: '每行一个' },
    },
    { name: 'sortOrder', type: 'number', label: '组内排序', admin: { position: 'sidebar', description: '数字越小越靠前' } },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '已发布', value: 'published' },
      ],
      admin: { position: 'sidebar' },
      label: '状态',
    },
  ],
}
