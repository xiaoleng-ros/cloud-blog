import type { CollectionConfig } from 'payload'

/** 博客文章集合：字段与前台 markdown frontmatter 对齐，正文用 Markdown 源码 + 实时预览 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'updatedAt'],
    preview: (doc) => `/posts/${doc.slug}/`,
  },
  labels: {
    singular: '文章',
    plural: '文章',
  },
  access: {
    read: () => true,
  },
  fields: [
    { name: 'title', type: 'text', required: true, label: '标题' },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: '文章标识（URL 用）',
      admin: {
        position: 'sidebar',
        description: '选择分类 + 填写标识，自动生成文章链接',
        components: {
          Field: '/src/admin/components/SlugField.tsx#SlugField',
        },
      },
    },
    { name: 'description', type: 'textarea', label: '摘要' },
    {
      name: 'cover',
      type: 'text',
      label: '封面图 URL',
      admin: { description: '支持外链或后台上传图片后的 URL' },
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      label: '分类',
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