'use client'
import { useEffect, useRef, useState } from 'react'
import { MAX_IMAGE_SIZE_BYTES, uploadMedia } from '../../lib/media-upload'

/**
 * 封面图上传器（纯展示组件，不绑 Payload 表单）
 *
 * 设计目标：让「外链 URL 输入」与「本地上传」共用同一个值通道。
 *   - 外链：用户在输入框里粘贴 URL，onChange 直接回传
 *   - 上传：点按钮选图 → POST /api/media → 拿到后端返回的图片 URL → onChange 回传
 *   - 预览：仅当图片加载成功时才渲染缩略图；加载失败只显示一行灰色提示，
 *           避免外链防盗链/超时撑出大片破图占位把按钮挤到看不见
 *
 * 被三处复用：
 *   1. CoverField.tsx —— Payload 原生 collection 编辑页的 cover 字段
 *   2. PublishModal.tsx —— 自定义写作页发布弹窗的封面输入
 *   3. SettingsEditView.tsx —— 站点设置「网站配置」的网站图标（配 cover-uploader--icon 缩小预览）
 *
 * @param value    当前图片 URL（外链或对象存储返回的绝对地址）
 * @param onChange 值变化回调，由调用方写回各自的状态层
 * @param disabled 禁用输入与上传（如发布中）
 * @param id       输入框 id，用于 FieldLabel 的 htmlFor 关联（可空）
 * @param className 追加到根节点的类名，供调用方改预览尺寸（如 favicon 小图预览）
 * @param placeholder 输入框占位文案，按语境写「请输入封面地址 / 图标地址」
 */
export interface CoverUploaderProps {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  id?: string
  className?: string
  placeholder?: string
}

/**
 * 封面图加载状态
 * - unknown：初始/URL 刚变，尚未确定能否加载
 * - ok：图片加载成功，渲染缩略预览
 * - fail：加载失败（防盗链/超时/失效），只显示一行提示
 */
type ImgStatus = 'unknown' | 'ok' | 'fail'

export const CoverUploader: React.FC<CoverUploaderProps> = ({ value, onChange, disabled, id, className, placeholder = '请输入图片地址' }) => {
  // 上传中状态：禁用按钮 + 按钮文案切换
  const [uploading, setUploading] = useState(false)
  // 上传错误提示（3-4 秒后自动清空，不打断填写节奏）
  const [uploadError, setUploadError] = useState('')
  // 图片加载状态：仅 ok 时才渲染预览框
  const [imgStatus, setImgStatus] = useState<ImgStatus>('unknown')
  // 隐藏的 file input：由按钮程序化触发，避免 <input type=file> 原生样式不受控
  const fileInputRef = useRef<HTMLInputElement>(null)

  // URL 变化时重置加载状态：空值直接 fail（不渲染预览），非空置 unknown 待重新检测
  useEffect(() => {
    setImgStatus(value ? 'unknown' : 'fail')
  }, [value])

  /**
   * 处理文件选择与上传
   *
   * 步骤：
   *   1. 校验类型（image/*）与大小（≤ 10MB，与正文图片共用阈值）
   *   2. 调 uploadMedia POST /api/media，拿到后端返回的图片 URL
   *   3. URL 回传给 onChange，由上层写回表单/状态
   *   4. 无论成功/失败都重置 file input 的 value，允许重选同一文件
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input value：让用户下次选同一文件也能触发 change 事件
    e.target.value = ''
    if (!file) return

    // 类型二次校验（accept 已过滤，这里兜底防止粘贴板等旁路）
    if (!file.type.startsWith('image/')) {
      setUploadError(`仅支持图片文件，收到的类型：${file.type}`)
      setTimeout(() => setUploadError(''), 3000)
      return
    }
    // 大小校验：MAX_IMAGE_SIZE_BYTES 在 media-upload.ts 统一定义，避免两处漂移
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setUploadError(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后重试（≤10MB）`)
      setTimeout(() => setUploadError(''), 3000)
      return
    }

    setUploading(true)
    try {
      const url = await uploadMedia(file)
      onChange(url)
    } catch (err) {
      setUploadError(`上传失败：${(err as Error).message}`)
      setTimeout(() => setUploadError(''), 4000)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={className ? `cover-uploader ${className}` : 'cover-uploader'}>
      {/* 隐藏的 file input：由「选择」按钮程序化触发 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 单框样式：图片小图标 + 地址输入 + 「选择」上传按钮合并为一个描边框 */}
      <div className="cover-uploader__combo">
        <svg
          className="cover-uploader__combo-glyph"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="m21 15-4.5-4.5L7 20" />
        </svg>
        <input
          id={id}
          type="text"
          className="cover-uploader__combo-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || uploading}
        />
        <button
          type="button"
          className="cover-uploader__combo-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? (
            '上传中…'
          ) : (
            <>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
                <path d="M12 21V9" />
                <path d="m16 13-4-4-4 4" />
              </svg>
              选择
            </>
          )}
        </button>
      </div>

      {/* 预览：仅加载成功时渲染，避免外链失败撑出大片空框 */}
      {value && imgStatus === 'ok' && (
        <img
          className="cover-uploader__preview"
          src={value}
          alt="封面预览"
          onLoad={() => setImgStatus('ok')}
          onError={() => setImgStatus('fail')}
        />
      )}
      {/* 加载失败：一行灰色提示，URL 已保留可继续编辑 */}
      {value && imgStatus === 'fail' && (
        <p className="cover-uploader__hint">
          该图片链接无法加载（可能防盗链或已失效），URL 已保留，可换地址或点右侧「选择」重新上传。
        </p>
      )}
      {/* 预渲染一个隐藏 img 用来探测加载状态：unknown 阶段不显示预览框但需触发检测 */}
      {value && imgStatus === 'unknown' && (
        <img
          src={value}
          alt=""
          aria-hidden="true"
          style={{ display: 'none' }}
          onLoad={() => setImgStatus('ok')}
          onError={() => setImgStatus('fail')}
        />
      )}

      {uploadError && <p className="cover-uploader__error">{uploadError}</p>}
    </div>
  )
}
