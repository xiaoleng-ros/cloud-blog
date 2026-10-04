import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIZE_BYTES } from '../lib/media-upload'

/**
 * 图片 / 多媒体集合：文章封面、正文图片、头像等上传文件都会存到这里。
 *
 * 存储后端由 payload.config.ts 里的 s3Storage 插件接管：
 *   - 配齐 S3 凭据（线上与本地同一条路径）：文件进 Supabase Storage，落库的 url
 *     即公开地址 …/storage/v1/object/public/<bucket>/<filename>，浏览器直连 Storage，
 *     不再经过 CMS 的 /api/media/file 代理
 *   - 未配 S3 凭据时：自动降级为本地 staticDir='media'
 *
 * access.read 保持公开，保证图片 URL 可直接被浏览器加载，不经过 Payload 鉴权。
 *
 * 服务端约束（不依赖后台组件）：
 *   - mimeTypes: upload collection 会校验真实文件头，Payload 默认还把 SVG 这类
 *     「可携带脚本的图片」列在 RESTRICTED 名单里直接拒绝，所以这里不需要额外处理
 *   - 大小：Payload 没有 maxFileSize 配置项，必须由 beforeValidate 钩子拦，
 *     否则绕过后台组件直接 POST /api/media 就能塞进任意大的文件
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
  // alt 修改会直接影响前台图片渲染，需清除同步快照 + 广播 SSE
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        // Payload 的顺序是 generateFileData → 字段 beforeValidate → 集合 beforeValidate，
        // 所以到这里真实字节数已经写在 data.filesize（sharp 重编码后的大小），
        // req.file.size 是上传时的原始大小；两个都读，纯改 alt 时两者都拿不到就跳过。
        const fileSize = data as { filesize?: number; size?: number } | undefined
        const size = Number(fileSize?.filesize ?? fileSize?.size ?? req.file?.size ?? 0)
        if (!size || size <= MAX_IMAGE_SIZE_BYTES) return data
        throw new APIError(
          `图片过大：${(size / 1024 / 1024).toFixed(1)}MB，上限 ${Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024)}MB`,
          400,
        )
      },
      ({ data }) => {
        // 像素上限：防「解压缩炸弹」（几 MB 的 PNG 解出上亿像素打爆内存）。
        // 字节数校验挡不住这类文件，必须看解码后的宽高。
        const dims = data as { width?: number; height?: number } | undefined
        const pixels = Number(dims?.width ?? 0) * Number(dims?.height ?? 0)
        if (pixels && pixels > MAX_IMAGE_PIXELS) {
          throw new APIError(
            `图片分辨率过高：约 ${(pixels / 1_000_000).toFixed(0)} 百万像素，上限 ${MAX_IMAGE_PIXELS / 1_000_000} 百万像素`,
            400,
          )
        }
        return data
      },
    ],
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
  },
}
