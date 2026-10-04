import type { CollectionConfig } from 'payload'
import { publishedOnlyForAnonymous } from '../lib/access'
import { syncInvalidateHook } from '../lib/sync-cache'

/** 博客文章集合：字段与前台 markdown frontmatter 对齐，正文用 Markdown 源码 + 实时预览 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  // 软删除：删除仅打 deletedAt 标记进回收站，所有默认查询（前台同步/列表/草稿箱）自动排除
  trash: true,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'updatedAt'],
    // URL 由「分类 / 文章 ID」拼接：/posts/{categoryName}/{postId}/
    // categoryName 来自 categories 关系（单选必填，见下方字段）
    preview: (doc) => {
      const cat = (doc as unknown as { categories?: { name?: string } | { name?: string }[] }).categories
      const name = Array.isArray(cat) ? cat[0]?.name : cat?.name
      return `/posts/${encodeURIComponent(name || '')}/${doc.id}/`
    },
    components: {
      // 定制管理列表：搜索/分类/标签/日期筛选 + 导出/导入 + 批量移入回收站
      views: {
        list: {
          Component: '/src/admin/views/manage/ManageListView.tsx#ManageListView',
        },
      },
    },
  },
  labels: {
    singular: '文章',
    plural: '文章',
  },
  access: {
    // 草稿不可匿名读取（见 lib/access）
    read: publishedOnlyForAnonymous({ trash: true }),
  },
  hooks: {
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
  },
  fields: [
    { name: 'title', type: 'text', required: true, label: '标题' },
    { name: 'description', type: 'textarea', label: '摘要' },
    {
      name: 'cover',
      type: 'text',
      label: '封面图',
      admin: {
        description: '支持外链 URL 或本地上传图片',
        components: {
          Field: '/src/admin/components/CoverField.tsx#CoverField',
        },
      },
    },
    // 文章分类：单选必填。URL 由「分类名 / 文章 ID」拼接，不再手填 slug
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      label: '文章分类',
      admin: {
        position: 'sidebar',
        description: '仅能选择系统里已有的分类，URL 由「分类名 + 文章 ID」自动拼接',
        components: {
          Field: '/src/admin/components/PostCategoryField.tsx#PostCategoryField',
        },
      },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      label: '标签',
    },
    {
      name: 'keywords',
      type: 'textarea',
      label: '关键词',
      admin: { description: '每行一个' },
    },
    {
      name: 'ai',
      type: 'textarea',
      label: 'AI 摘要',
      admin: { description: '每行一个，第一行作为列表页摘要兜底' },
    },
    {
      name: 'sticky',
      type: 'number',
      label: '置顶权重',
      admin: { position: 'sidebar', description: '大于 0 进入首页精选' },
    },
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
    {
      name: 'content',
      type: 'textarea',
      label: '正文内容（Markdown）',
      admin: {
        description: 'Markdown 源码，右侧实时预览',
        components: {
          Field: '/src/editor/MarkdownEditor.tsx#MarkdownEditorField',
        },
      },
    },
  ],
}