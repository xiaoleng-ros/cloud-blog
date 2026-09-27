/**
 * 通用媒体上传工具（Markdown 编辑器 / 封面上传 共用）
 *
 * 设计原则：
 * 1. 单一上传入口，避免正文图片与封面图片各写一份 10MB 检查导致阈值漂移；
 * 2. 走同源 `/api/media`，浏览器自动带 cookie 完成 Payload 会话认证；
 * 3. 返回 Payload upload collection 生成的可访问相对 URL（形如 /media/xxx.png）。
 */

/** 图片上传前端大小上限 10MB，与后端 Payload upload collection 的限制保持一致 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

/**
 * 调用 Payload Media 上传接口
 *
 * @param file 用户选择的图片或剪贴板/拖拽产生的图片文件
 * @returns 上传成功后图片的可访问相对 URL
 * @throws 上传失败时抛出 Error，交由调用方展示
 *
 * 说明：Payload upload collection 默认把表单字段名接收为 `file`；
 *      生产走 S3，本地走 staticDir='media'，二者返回的 URL 结构一致。
 */
export async function uploadMedia(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/media', {
    method: 'POST',
    body: fd,
    // 同源请求默认带 cookie，显式声明兜底
    credentials: 'same-origin',
  })
  if (!res.ok) {
    // 尽量从 Payload 的错误响应里取业务错误信息
    let msg = `上传失败（HTTP ${res.status}）`
    try {
      const json = (await res.json()) as { errors?: Array<{ message?: string }> }
      if (json.errors?.[0]?.message) msg = json.errors[0].message
    } catch {
      // 忽略响应体解析失败，保留默认错误信息
    }
    throw new Error(msg)
  }
  const json = (await res.json()) as { doc?: { url?: string } }
  const url = json.doc?.url
  if (!url) throw new Error('上传响应缺少 url 字段')
  return url
}
