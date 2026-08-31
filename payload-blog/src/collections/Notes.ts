import type { CollectionConfig } from 'payload'

/** 随笔集合：对齐前台 src/content/notes/*.md */
export const Notes: CollectionConfig = {
  slug: 'notes',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['date', 'title', 'status', 'updatedAt'],
  },
  labels: {
    singular: '随笔',
    plural: '随笔',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'date',
      type: 'date',
      required: true,
      label: '日期',
      admin: { date: { displayFormat: 'yyyy-MM-dd' }, description: '随笔按年/月分组' },
    },
    { name: 'title', type: 'text', label: '标题（可选）' },
    { name: 'mood', type: 'text', label: '心情（可选）' },
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
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      label: '标签',
    },
    {
      name: 'content',
      type: 'textarea',
      label: '正文内容（Markdown）',
      admin: {
        components: {
          Field: '/src/editor/MarkdownEditor.tsx#MarkdownEditorField',
        },
      },
    },
  ],
}