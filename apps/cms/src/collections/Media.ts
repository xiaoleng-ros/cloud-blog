import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIZE_BYTES, incrementFilenameSuffix, toStorageSafeFilename } from '../lib/media-upload'

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
  admin: {
    useAsTitle: 'filename',
    components: {
      // 定制图片管理页：网格缩略图 + 上传/搜索/多选删除
      views: {
        list: {
          Component: '/src/admin/views/media/MediaListView.tsx#MediaListView',
        },
      },
    },
  },
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
    /**
     * 把上传失败的**真实原因**回给登录管理员。
     *
     * 为什么必须这么做：Payload 认为 500 级内部错误的细节「可能含敏感信息」，
     * routeError 会把它们统一换成 `Something went wrong.`，于是线上只看得到
     * `POST /api/media 500`，分不清是凭据错、端点错、sharp 没进包还是写库失败
     * —— EdgeOne 云函数又不给交互式日志，等于完全瞎掉。
     *
     * 这里只对**已登录**的请求放开：未登录访客（攻击者拿不到会话）仍然只看到
     * 原样的笼统文案，信息面没有扩大；管理员则能直接在后台的报错提示里看到根因。
     */
    afterError: [
      ({ error, req, result }) => {
        // 先无条件打日志：EdgeOne 的日志面板能捞到，是排查的主渠道
        const e = error as { name?: string; message?: string; status?: number; code?: string; cause?: unknown }
        console.error('[media] 上传/写入失败:', e?.name, '|', e?.message, '| status=', e?.status, '| code=', e?.code, '| cause=', String((e?.cause as { message?: string })?.message ?? e?.cause ?? ''))
        if (!req.user) return
        // APIError（4xx）本来就有可读 message，只有被改写成通用文案的才需要还原
        const message = error?.message || String(error)
        if (!message || message === 'Something went wrong.') return
        return {
          ...(result ? { response: { ...result, message } } : {}),
          status: (error as { status?: number })?.status ?? 500,
        }
      },
    ],
    beforeValidate: [
      /**
       * 把文件名洗成 Supabase Storage 能接受的 ASCII 形状。
       *
       * 为什么必须在服务端做：浏览器端（media-upload.ts）已经洗过一次，但
       * `POST /api/media` 是公开可调用的 REST 端点，任何人拿会话（或以后加的
       * API key）都能绕过前端直接传 `我的照片.jpg`。Payload 自己的
       * `sanitizeFilename` 只处理控制字符与 Windows 非法字符，不管中文；而
       * Supabase 的 S3 接口对 Key 做白名单校验，非 ASCII 一律 `InvalidKey`——
       * 那是在 afterChange 里 throw 出来的，用户只会看到一次 500。
       *
       * 时机：Payload 的顺序是 generateFileData（设 filename）→ 字段
       * beforeValidate → 集合 beforeValidate，所以这里改 `data.filename`
       * 能同时影响落库值与 afterChange 写 S3 用的 Key。唯一副作用是
       * getSafeFileName 的去重发生在我们之前，所以这里带 `dedupeSeed` 加
       * 短哈希后缀，避免洗完与已有文件撞名。
       *
       * ⚠ 但哈希后缀只解决「不同原名洗成同一结果」，不解决「同一原名传两次」：
       *   种子都是原始文件名 → 后缀相同 → 撞 media.filename 唯一约束变成 400。
       *   所以洗完之后还要查库确认唯一，重名就按 Payload 同款规则递增数字后缀。
       */
      async ({ data, req, operation, originalDoc }) => {
        const filename = (data as { filename?: unknown } | undefined)?.filename
        if (typeof filename !== 'string' || filename === '') return data
        const safe = toStorageSafeFilename(filename, req.file?.name || filename)
        if (safe === filename) return data

        // 洗完的名字可能已被占用（同一张图重复上传是最常见的情况）。
        // 查库而不是猜：Supabase 侧 Key 无妨覆盖，真正的墙是 media.filename 唯一约束。
        let unique = safe
        const selfId = operation === 'update' ? (originalDoc as { id?: number } | undefined)?.id : undefined
        for (let guard = 0; guard < 50; guard++) {
          const clash = await req.payload.find({
            collection: 'media',
            where: { filename: { equals: unique } },
            limit: 1,
            depth: 0,
            pagination: false,
            overrideAccess: true,
          })
          const hit = clash.docs[0] as { id?: number } | undefined
          // 编辑已有记录时，撞到的如果是自己，就不算冲突
          if (!hit || (selfId !== undefined && hit.id === selfId)) break
          unique = incrementFilenameSuffix(unique)
        }
        return { ...data, filename: unique }
      },
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
