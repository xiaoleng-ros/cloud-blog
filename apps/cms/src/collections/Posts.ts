import type { CollectionConfig } from 'payload'
import { sanitizeSlug, sanitizeTerm } from 'cloud-blog/shared/post-utils'
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
    // URL 由「分类标识 / 文章 ID」拼接：/posts/{categorySlug}/{postId}
    // categorySlug 来自 categories 关系的 slug 字段；未填 slug 时回退分类名
    // （与前台 getPostCategorySegment 同一口径，见 shared/post-utils）
    preview: (doc) => {
      const cat = (doc as unknown as {
        categories?: { name?: string; slug?: string } | { name?: string; slug?: string }[]
      }).categories
      const ref = Array.isArray(cat) ? cat[0] : cat
      // 与前台 getPostCategorySegment 同口径：slug 优先（做 URL 段清洗），空则回退分类名
      const segment =
        sanitizeSlug(ref?.slug ?? '') || sanitizeTerm(ref?.name ?? '') || 'uncategorized'
      return `/posts/${encodeURIComponent(segment)}/${doc.id}`
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
    // 文章分类：单选必填。URL 由「分类标识 / 文章 ID」拼接（分类未填标识时回退分类名），不手填 slug
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      label: '文章分类',
      admin: {
        position: 'sidebar',
        description:
          '仅能选择系统里已有的分类。URL 由「分类标识 + 文章 ID」自动拼接（分类未填标识时回退分类名）',
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