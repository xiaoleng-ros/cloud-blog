import type { CollectionConfig } from 'payload'

/** 图片 / 多媒体集合：文章封面、头像等上传文件都会存到这里，并生成缩略图 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true, // 公开可读，保证文章图片可访问
  },
  labels: {
    singular: '图片',
    plural: '图片',
  },
  upload: {
    staticDir: 'media', // 上传文件本地目录
    mimeTypes: ['image/*'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: '替代文本（SEO 用）',
    },
  ],
}