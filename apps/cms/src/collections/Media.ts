import type { CollectionConfig } from 'payload'

/**
 * 图片 / 多媒体集合：文章封面、正文图片、头像等上传文件都会存到这里。
 *
 * 存储后端由 payload.config.ts 里的 s3Storage 插件接管：
 *   - 生产（EdgeOne）：走 Supabase Storage（S3 兼容接口），文件不进容器磁盘
 *   - 本地（未配 S3_* 环境变量）：自动降级为本地 staticDir='media'
 *
 * access.read 保持公开，保证图片 URL 可直接被浏览器加载，不经过 Payload 鉴权。
 */
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
    // 本地开发用：无 S3 凭据时，Payload 走此目录存到本地磁盘。
    // 生产环境配了 s3Storage 插件后，此项被插件覆盖（disableLocalStorage=true 时忽略）。
    staticDir: 'media',
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
