'use client'
import { FieldError, FieldLabel, useField } from '@payloadcms/ui'
import { CoverUploader } from './CoverUploader'

/**
 * 文章封面（cover）自定义字段
 *
 * 背景：Posts collection 的 cover 字段原为 `type: 'text'`，
 *      Payload 原生 admin UI 只会渲染一个普通文本输入框，没有上传按钮。
 *      本组件挂到字段的 admin.components.Field 上，替换原生渲染，
 *      让封面既能粘贴外链 URL、又能直接本地上传图片（走 /api/media）。
 *
 * 实现：
 *   1. useField({ path }) 拿到与 Payload 表单双向绑定的 value / setValue
 *   2. 转传给 CoverUploader 纯展示组件（输入框 + 上传按钮 + 预览）
 *   3. 用 FieldLabel / FieldError 保持与原生字段一致的标签与错误样式
 *
 * @param props.path  Payload 字段路径（如 'cover'）
 * @param props.label 字段标签（来自 collection 定义）
 */
export const CoverField: React.FC<{ path: string; label?: string }> = ({ path, label }) => {
  // value/setValue 与 Payload 表单的 cover 字段双向绑定
  // useField 返回的 value 是 unknown，cover 是 text 字段，断言为 string
  const { value, setValue, showError, errorMessage } = useField({ path })

  return (
    <div className="cover-field">
      <FieldLabel htmlFor={path} label={label || '封面图'} path={path} />
      <CoverUploader
        id={path}
        value={typeof value === 'string' ? value : ''}
        onChange={setValue}
      />
      <FieldError message={errorMessage} showError={showError} />
    </div>
  )
}
