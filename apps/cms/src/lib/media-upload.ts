/**
 * 通用媒体上传工具（Markdown 编辑器 / 封面上传 / 图片管理 共用）
 *
 * 设计原则：
 * 1. 单一上传入口，避免正文图片与封面图片各写一份大小检查导致阈值漂移；
 * 2. 走同源 `/api/media`，浏览器自动带 cookie 完成 Payload 会话认证；
 * 3. 返回 Payload upload collection 生成的可访问 URL（S3 激活时为 Supabase 公开地址，未激活时为本地相对路径）。
 *
 * ── 为什么需要浏览器端压缩（2026-10-22 修）──────────────────────────────
 * 线上部署在腾讯 EdgeOne 云函数上，函数前面那层网关对**请求体**有 6MB 硬上限。
 * 实测：文件 5.86MB 仍能进到应用层（返回业务 JSON），文件 6.00MB 起直接返回
 * `Tencent Edgeone` 的 HTML 500 页面——请求根本没到我们的代码，所以：
 *   · 后端的体积校验不会触发（它看到的是 413/400，而不是平台页）
 *   · 前端能拿到的只有 `HTTP 500`，看不出任何原因
 *   · Sharp、S3、凭据全部正常也会失败（这曾让排查方向严重跑偏）
 * 手机直出照片（iPhone 12MP ≈ 3–7MB，48MP ≈ 12MB）很容易越过这条线。
 * 因此上传前先在 canvas 里降采样 + 重编码，把体积压进 `UPLOAD_TARGET_BYTES`。
 */

/**
 * 服务端的体积兜底上限。
 *
 * ⚠ 注意它**防不住**真正的麻烦：平台网关在 6MB 就把请求掐掉了（return 的是
 * EdgeOne 的 HTML 500，根本没进 Payload），所以 6–10MB 这一段永远不会触发这个
 * 校验。它只在非浏览器客户端发来 5–6MB 文件时起作用。真正保证体积的是
 * `UPLOAD_TARGET_BYTES`（压缩目标）。
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

/** 图片像素上限 4000 万（约 8000×5000），拦截解压缩炸弹类文件 */
export const MAX_IMAGE_PIXELS = 40_000_000

/**
 * 用户**原始文件**的上限（压缩前）。
 *
 * 与 `MAX_IMAGE_SIZE_BYTES` 的区别：那个是「提交给服务端的文件」的上限，这个
 * 是「用户丢进来的原图」的上限。两者不能共用一个常量——否则一张 15MB 的
 * 48MP 照片会在压缩之前就被前端拒绝，而它压完只有 0.3MB，完全能传。
 */
export const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024

/**
 * EdgeOne 云函数前的网关对请求体的硬上限 = 6MB（实测 6.00MB 起返回 HTML 500）。
 * 留在这里是为了让后来人一眼看到这个数字的出处，代码里不直接用它做判断。
 */
export const PLATFORM_BODY_LIMIT_BYTES = 6 * 1024 * 1024

/** 压缩目标体积：平台上限 6MB 留 25% 余量（multipart 头 + 编码误差） */
export const UPLOAD_TARGET_BYTES = Math.round(4.5 * 1024 * 1024)

/** 压缩后保留的长边像素数：2560 足够正文显示，且能把 48MP 压到 0.3MB */
const MAX_LONG_EDGE = 2560

/** 逐档降质，先试高画质，进预算就停 */
const QUALITY_STEPS = [0.9, 0.82, 0.72, 0.62, 0.5]

/** 这些格式不做 canvas 压缩：SVG 是矢量（栅格化反而变糊且更大），GIF 可能是动图（压完只剩一帧） */
const NON_COMPRESSIBLE_TYPES = new Set(['image/svg+xml', 'image/gif'])

type Decoded = {
  width: number
  height: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  close: () => void
}

/** 解码图片：优先 createImageBitmap（快且不占主线程），失败再退回 <img> */
async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      }
    } catch {
      // Safari 对某些 HEIC/CMYK JPEG 会抛，落到 <img> 分支再试一次
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法解码该图片'))
      el.src = url
    })
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/** 把解码结果按指定尺寸/质量重编码成 Blob */
function encodeImage(decoded: Decoded, w: number, h: number, type: string, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 canvas，无法压缩图片')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // JPEG 没有 alpha 通道，透明区域会变黑，先铺白底（深色编辑器里也符合直觉）
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  decoded.draw(ctx, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      type,
      quality,
    )
  })
}

/** 换扩展名，保证文件名与实际编码一致（Payload 用文件名推扩展、用文件头判真实类型） */
function renameForType(name: string, type: string): string {
  const ext = type === 'image/webp' ? '.webp' : '.jpg'
  const base = name.replace(/\.[^./\\]+$/, '')
  return `${base}${ext}`
}

/**
 * 把文件名压成 Supabase Storage 能接受的形状。
 *
 * ── 为什么必须压（2026-10-22 实测）────────────────────────────────
 * Supabase Storage 的 S3 `PutObject` 对 Key 做白名单校验：只收 ASCII，且 `#`
 * `%` `~` 也会被拒。任何非 ASCII（中文、日文、重音字母、emoji）一律返回
 * `InvalidKey: Invalid key: <key>`，插件在 afterChange 里原样 throw，最终变成
 * 一次 500——而 Payload 自己的 `sanitizeFilename` 只处理控制字符和 Windows
 * 非法字符，完全不管中文，所以中文文件名一路畅通到 S3 才炸。
 * 用户侧只看到 `Something went wrong.`，等于「传不上去」。
 *
 * 规则：允许 `[A-Za-z0-9._ -]`，其余字符逐个换成 `-`，折叠连续 `-`，去掉首尾
 * 的 `-`/空格/点。ASCII 名字原样返回（保证幂等，调用方可用 `!==` 判断是否改过）。
 * 完全没有可读残留时（纯中文名是典型情况）退回 `image` + 保留扩展名，重名由
 * 调用方去重。
 *
 * @param dedupeSeed 传入原始文件名时，若名字被改动则追加 6 位短哈希后缀。
 *        服务端必须传它：`getSafeFileName` 去重发生在 beforeValidate **之前**，
 *        洗完名字后可能与库里已有的 `image.jpg` 撞车，加后缀才能保持唯一。
 */
export function toStorageSafeFilename(filename: string, dedupeSeed?: string): string {
  const dot = filename.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < filename.length - 1
  const rawBase = hasExtension ? filename.slice(0, dot) : filename
  const rawExt = hasExtension ? filename.slice(dot + 1) : ''

  const base = rawBase
    .replace(/[^A-Za-z0-9._ -]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-\s.]+/, '')
    .replace(/[-\s.]+$/, '')
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, '')

  // 只剩标点/数字这种没有信息量的残留时，也当作「没有可读名字」
  const meaningful = base.replace(/[^A-Za-z0-9]/g, '')
  const stem = meaningful.length >= 2 ? base : 'image'
  const candidate = `${stem}${ext ? `.${ext}` : ''}`
  if (candidate === filename) return filename
  if (!dedupeSeed) return candidate

  // 用种子算后缀而不是随机数：同一文件名每次都得到同一结果，便于重试与排查
  const suffix = shortHash(dedupeSeed)
  return `${stem}-${suffix}${ext ? `.${ext}` : ''}`
}

/**
 * 给文件名追加 / 递增数字后缀，避开重名。
 *
 * 规则与 Payload 自己的 `incrementName` 保持一致（uploads/getSafeFileName.js）：
 * `photo.jpg` → `photo-1.jpg`，`photo-1.jpg` → `photo-2.jpg`，`photo-99.jpg` → `photo-100.jpg`。
 * 必须同规则，否则两边交替改名会互相踩。
 *
 * 存在理由：服务端洗完文件名后，可能与库里已有文件撞名。Payload 的
 * `getSafeFileName` 在 beforeValidate **之前**跑，它看到的是原始（可能是中文）
 * 文件名，因此「两张都叫 我的照片.jpg」的第二次上传会算出同一个
 * `image-xxxxxx.jpg`，直接撞 `media.filename` 的唯一约束变成 400。
 */
export function incrementFilenameSuffix(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < filename.length - 1
  const base = hasExtension ? filename.slice(0, dot) : filename
  const ext = hasExtension ? filename.slice(dot + 1) : ''
  const matched = /^(.*)-(\d+)$/.exec(base)
  // Number() 而不是 parseInt：`-007` 这种要归一到 -8，避免与已有 -8 撞
  const next = matched ? `${matched[1]}-${Number(matched[2]) + 1}` : `${base}-1`
  return ext ? `${next}.${ext}` : next
}

/** 6 位十六进制哈希（FNV-1a），不引 crypto，前后端同构可用 */
function shortHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

/**
 * 需要压缩吗？
 *
 * 只在**会撞上平台上限**时才压，不无差别重编码——一张 2MB 的图本来就传得上去，
 * 压它只会白白掉画质。4.5MB 这个门槛比 6MB 平台线低 25%，留足余量。
 */
export function needsCompression(file: File): boolean {
  if (NON_COMPRESSIBLE_TYPES.has(file.type)) return false
  return file.size > UPLOAD_TARGET_BYTES
}

/**
 * 把图片压到 `UPLOAD_TARGET_BYTES` 以内。
 *
 * 策略：长边超过 2560 先降采样（这一步对体积的贡献最大），再逐档降质。
 * 有 alpha 的图输出 WebP（保透明），其余输出 JPEG（兼容性最好、体积最小）。
 *
 * @throws 解码失败或压不进预算时抛错，由调用方决定是拦住用户还是退回原图
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined') return file // SSR 保护：只可能在浏览器里被调用

  const decoded = await decodeImage(file)
  try {
    const longEdge = Math.max(decoded.width, decoded.height)
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
    const w = Math.max(1, Math.round(decoded.width * scale))
    const h = Math.max(1, Math.round(decoded.height * scale))

    const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp'
    const outType = keepsAlpha ? 'image/webp' : 'image/jpeg'

    let smallest: Blob | null = null
    for (const quality of QUALITY_STEPS) {
      const blob = await encodeImage(decoded, w, h, outType, quality)
      if (blob.size <= UPLOAD_TARGET_BYTES) {
        return new File([blob], renameForType(file.name, outType), { type: outType })
      }
      if (!smallest || blob.size < smallest.size) smallest = blob
    }
    // 降到最低画质仍超预算：把最小的那份交出去，让上传过程自己暴露问题，
    // 比在这里抛一个用户无法处置的错要好（一般不会走到，2560px 已远低于 4.5MB）
    if (smallest) return new File([smallest], renameForType(file.name, outType), { type: outType })
    throw new Error('图片压缩失败')
  } finally {
    decoded.close()
  }
}

/**
 * 调用 Payload Media 上传接口
 *
 * @param file 用户选择的图片或剪贴板/拖拽产生的图片文件
 * @param meta 可选字段。**必须走 `_payload` JSON 字段**，不能作为裸 FormData 字段：
 *             Payload 的 `addDataAndFileToRequest` 只解析 `fields._payload`，其他
 *             multipart 普通字段会被静默丢弃（实测 `alt` 传了也落库成 null）
 * @returns 上传成功后图片的可访问 URL
 * @throws 上传失败时抛出 Error，交由调用方展示
 *
 * 说明：Payload upload collection 默认把表单字段名接收为 `file`；
 *      配齐 S3 凭据返回 Supabase 公开绝对地址，未配则返回 /api/media/file/… 本地相对路径。
 */
export async function uploadMedia(file: File, meta?: { alt?: string }): Promise<string> {
  // 先压缩：平台网关 6MB 上限是硬墙，越过去连我们的代码都进不来
  let payload = file
  if (needsCompression(file)) {
    try {
      payload = await compressImage(file)
    } catch {
      // 压缩不了（HEIC / 少见编码）：原图若本来就超线，直接给可读错误，
      // 不要让它撞平台网关变成一句无信息的 HTTP 500
      if (file.size > UPLOAD_TARGET_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1)
        throw new Error(`图片有 ${mb}MB，且浏览器无法自动压缩该格式，请先转成 JPG/PNG 再上传`)
      }
      payload = file
    }
  }

  const fd = new FormData()
  // 文件名必须先把非 ASCII 洗掉：Supabase Storage 会以 InvalidKey 拒绝，最终变成 500
  const safeName = toStorageSafeFilename(payload.name || 'image')
  const upload = safeName === payload.name ? payload : new File([payload], safeName, { type: payload.type })
  fd.append('file', upload)
  // 普通字段只有 `_payload` 会被 Payload 解析进 req.data，其余裸字段会被丢掉
  if (meta && Object.keys(meta).length > 0) {
    fd.append('_payload', JSON.stringify(meta))
  }
  const res = await fetch('/api/media', {
    method: 'POST',
    body: fd,
    // 同源请求默认带 cookie，显式声明兜底
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const ctype = res.headers.get('content-type') ?? ''
    let msg = `上传失败（HTTP ${res.status}）`
    if (ctype.includes('application/json')) {
      try {
        const json = (await res.json()) as { errors?: Array<{ message?: string }> }
        if (json.errors?.[0]?.message) msg = json.errors[0].message
      } catch {
        // 忽略响应体解析失败，保留默认错误信息
      }
    } else if (ctype.includes('text/html')) {
      // 平台网关的 HTML 错误页：请求没到应用层，最典型的原因就是体积越线
      msg = `上传失败（HTTP ${res.status}）：请求在服务器网关处被拒绝，通常是图片体积超过平台上限，请压缩后重试`
    }
    throw new Error(msg)
  }
  const json = (await res.json()) as { doc?: { url?: string } }
  const url = json.doc?.url
  if (!url) throw new Error('上传响应缺少 url 字段')
  return url
}
