'use client'
import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { FieldError, FieldLabel, useField, useFieldPath, useTheme } from '@payloadcms/ui'
import type { FieldClientComponent, TextFieldClient } from 'payload'

type Mode = 'sv' | 'wysiwyg'

// 编辑器默认高度，和原 Monaco 版本保持一致
const EDITOR_HEIGHT = 520

/**
 * 调用 Payload Media 上传接口
 *
 * @param file 用户选择的图片或剪贴板/拖拽产生的图片文件
 * @returns 上传成功后图片的可访问相对 URL
 * @throws 上传失败时抛出 Error，交给 Vditor 内部错误回调展示
 *
 * 说明：走同源相对路径 /api/media，浏览器自动带登录 cookie 完成会话认证；
 *      Payload 的 upload collection 默认把字段名接收为 `file`。
 */
async function uploadMedia(file: File): Promise<string> {
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

/**
 * Vditor 自定义上传入口（内部实现，async 版本）
 *
 * @param files 待上传文件数组
 * @returns 成功返回 null，失败返回错误信息字符串
 */
async function handleVditorUpload(files: File[]): Promise<string | null> {
  if (!files.length) return null
  // 前端二次拦截非图片（保险起见，虽然 Vditor 的 accept 已经过滤）
  const nonImage = files.find((f) => !f.type.startsWith('image/'))
  if (nonImage) return `仅支持图片文件，收到的类型：${nonImage.type}`
  // 前端大小上限 10MB，防止误传大文件导致后台 413
  const tooLarge = files.find((f) => f.size > 10 * 1024 * 1024)
  if (tooLarge) return `图片过大（${(tooLarge.size / 1024 / 1024).toFixed(1)}MB），请压缩后重试（≤10MB）`
  try {
    const urls = await Promise.all(files.map((f) => uploadMedia(f)))
    // Vditor 会把每张图按顺序插入到光标位置
    urls.forEach((url, i) => {
      console.log(`[MarkdownEditor] 图片 ${i + 1} 上传成功：${url}`)
    })
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/**
 * Markdown 编辑器（Vditor 封装）
 *
 * 功能：
 * - 支持「分屏预览」（左编辑右预览，默认）和「所见即所得」两种模式切换
 * - 支持图片三种录入方式：工具栏按钮 / 拖拽 / 剪贴板粘贴，均自动上传到 Payload Media
 * - 跟随 Payload 亮/暗主题，输入实时回调 onChange 通知外部
 * - 外部 value 变化时（编辑旧文章回填、自动保存恢复）通过 setValue 同步
 *
 * @param props.value 当前 Markdown 源码
 * @param props.onChange 内容变化回调（传入新的源码）
 * @param props.label 可选字段标签
 */
export const MarkdownEditor: React.FC<{
  value: string
  onChange: (v: string) => void
  label?: React.ReactNode
}> = ({ value, onChange, label }) => {
  // 跟随 Payload 亮/暗主题
  const { theme } = useTheme()
  // 默认分屏预览模式（左边写、右边实时预览）
  const [mode, setMode] = useState<Mode>('sv')
  // Vditor 实例引用
  const instanceRef = useRef<Vditor | null>(null)
  // 编辑器挂载 DOM
  const hostRef = useRef<HTMLDivElement>(null)
  // 用 ref 持有最新 onChange，避免闭包陷阱
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // 内部值追踪：区分"用户输入触发的回调"和"外部回填触发的 setValue"
  const internalValueRef = useRef(value ?? '')

  // 初始化编辑器：仅在 mode 切换时重建（Vditor 不支持运行时切模式）
  useEffect(() => {
    if (!hostRef.current) return
    // 清理旧实例（StrictMode 双挂载 / 切模式时都要 destroy）
    instanceRef.current?.destroy()
    instanceRef.current = null
    hostRef.current.innerHTML = ''

    // 记录初始值，便于区分外部回填 vs 用户输入
    internalValueRef.current = value ?? ''

    const instance = new Vditor(hostRef.current, {
      value: value ?? '',
      mode,
      height: EDITOR_HEIGHT,
      theme: theme === 'dark' ? 'dark' : 'classic',
      placeholder: '开始写你的文章... 支持拖拽 / 粘贴图片',
      lang: 'zh_CN',
      cache: { enable: false }, // ComposeView 自己管 localStorage，这里关闭
      toolbar: [
        'emoji', 'headings', 'bold', 'italic', 'strike', 'code', 'inline-code',
        '|',
        'quote', 'insert-after', 'insert-before', 'link', 'image', 'upload',
        'table',
        '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent',
        '|',
        'line',
        '|',
        'edit-mode', 'help', 'undo', 'redo',
        '|',
        'preview', 'content-theme', 'code-theme', 'counter', 'fullscreen', 'info',
      ],
      preview: {
        delay: 300, // 从 250ms 上调到 300ms，减少长文渲染抖动
        markdown: {
          // 关闭 XSS 过滤（信任作者内容，同时保留前台 remark 的处理链）
          sanitize: false,
          autoSpace: false,
          callout: false,
          toc: false,
          footnotes: false,
          imageCaption: true,
        },
      },
      // 自定义上传：工具栏「上传图片」+ 拖拽 + 剪贴板粘贴 三个入口统一走这里
      upload: {
        fieldName: 'file',
        max: 10 * 1024 * 1024, // 前端限制 10MB
        accept: 'image/*',
        multiple: true,
        // 类型断言：Vditor 声明的 handler 返回类型是联合 (string | Promise<string> | Promise<null> | null)
        // 我们统一用 Promise<string | null>，运行时行为完全等价，仅需 TS 层面断言
        handler: ((files: File[]) => handleVditorUpload(files)) as (
          files: File[]
        ) => string | Promise<string> | Promise<null> | null,
        success: () => undefined,
        error: (msg) => console.error('[MarkdownEditor] 上传错误：', msg),
      },
      input: (v) => {
        // 用户输入触发的值变化：更新内部记录 + 回调外部
        internalValueRef.current = v
        onChangeRef.current(v)
      },
    })
    instanceRef.current = instance
  }, [mode, theme])

  // 外部 value 变化时同步到编辑器（编辑旧文章回填、自动保存恢复）
  // 忽略"用户刚输入导致的回调循环"：只有当外部值 != 内部最新值时才 setValue
  useEffect(() => {
    const external = value ?? ''
    if (external === internalValueRef.current) return
    internalValueRef.current = external
    instanceRef.current?.setValue(external, true)
  }, [value])

  const tabs: { key: Mode; label: string }[] = [
    { key: 'sv', label: '分屏预览' },
    { key: 'wysiwyg', label: '所见即所得' },
  ]

  return (
    <div className="markdown-editor">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        {label ? <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span> : null}
        <div style={{ display: 'flex', gap: '4px' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid var(--theme-elevation-150, #ccc)',
                background: mode === tab.key ? '#1c3b27' : 'transparent',
                color: mode === tab.key ? '#fff' : 'inherit',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vditor 挂载点：高度由构造参数控制 */}
      <div ref={hostRef} />
    </div>
  )
}

/**
 * Payload 字段版包装：在原生表单中通过 useField 绑定字段路径，
 * 再把受控组件渲染为表单的一环（Posts/Notes 的 content 字段使用）
 */
export const MarkdownEditorField: FieldClientComponent<TextFieldClient> = ({ field }) => {
  const path = useFieldPath()
  const { value, setValue, showError, errorMessage } = useField({ path })
  const label = field.label
  return (
    <div className="markdown-editor">
      <FieldLabel htmlFor={`field-${path}`} label={label} />
      <MarkdownEditor value={value ?? ''} onChange={(v) => setValue(v)} />
      <FieldError message={errorMessage} showError={showError} />
    </div>
  )
}

export default MarkdownEditor
