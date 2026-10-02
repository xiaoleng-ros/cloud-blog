'use client'
import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { FieldError, FieldLabel, useField, useFieldPath, useTheme } from '@payloadcms/ui'
import type { FieldClientComponent, TextFieldClient } from 'payload'
import { MAX_IMAGE_SIZE_BYTES, uploadMedia } from '../lib/media-upload'

type Mode = 'sv' | 'wysiwyg'

// 编辑器默认高度，和原 Monaco 版本保持一致
const EDITOR_HEIGHT = 520

// Vditor 分屏预览延迟的分级配置
// - 短文（≤ 5000 字）：300ms，兼顾响应速度
// - 长文（> 5000 字）：500ms，减少每次按键触发的全量 markdown 渲染抖动
const PREVIEW_DELAY_SHORT = 300
const PREVIEW_DELAY_LONG = 500
const PREVIEW_DELAY_LONG_THRESHOLD = 5000

/**
 * 根据正文长度计算 Vditor 分屏预览的防抖延迟
 *
 * @param length 当前正文字符数
 * @returns 预览防抖延迟（ms），短文 300 / 长文 500
 */
const resolvePreviewDelay = (length: number): number =>
  length > PREVIEW_DELAY_LONG_THRESHOLD ? PREVIEW_DELAY_LONG : PREVIEW_DELAY_SHORT

/**
 * Vditor 自定义上传入口（内部实现，async 版本）
 *
 * ⚠ 关键坑：Vditor 自定义 handler 分支**不会**自动把图片插入编辑器（源码 index.js:6204-6215），
 *   handler 返回 null 时 Vditor 直接 return，返回字符串才显示为 tip。
 *   所以这里必须显式调用 instance.insertMD() 才能让用户看到图片。
 *
 * @param files 待上传文件数组
 * @param instance 当前 Vditor 实例，用于成功插入与错误提示
 * @returns 成功返回 null，失败返回错误信息字符串（会由 Vditor 内部 tip 展示）
 */
async function handleVditorUpload(files: File[], instance: Vditor | null): Promise<string | null> {
  if (!files.length) return null
  // 前端二次拦截非图片（保险起见，虽然 Vditor 的 accept 已经过滤）
  const nonImage = files.find((f) => !f.type.startsWith('image/'))
  if (nonImage) return `仅支持图片文件，收到的类型：${nonImage.type}`
  // 前端大小上限 10MB，防止误传大文件导致后台 413
  const tooLarge = files.find((f) => f.size > MAX_IMAGE_SIZE_BYTES)
  if (tooLarge)
    return `图片过大（${(tooLarge.size / 1024 / 1024).toFixed(1)}MB），请压缩后重试（≤10MB）`
  try {
    const urls = await Promise.all(files.map((f) => uploadMedia(f)))
    // 手动插入到光标位置：Vditor 自定义 handler 不会自动插入
    if (instance) {
      urls.forEach((url) => instance.insertMD(`![](${url})`))
    }
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
  // 最新外部值：Vditor 构造函数是异步初始化的，初始化完成前外部回填的值会被丢弃，
  // 所以必须单独记住最新值，等 after 回调（初始化完成）后再补一次同步
  const latestValueRef = useRef(value ?? '')
  latestValueRef.current = value ?? ''
  // Vditor 是否已完成异步初始化（i18n / lute 脚本加载完成）。
  // 初始化完成前 this.vditor 尚未建立，此时调用 setValue 会抛异常，必须先跳过。
  const readyRef = useRef(false)

  // 初始化编辑器：仅在 mode 或 theme 切换时重建（Vditor 不支持运行时切模式）
  useEffect(() => {
    const container = hostRef.current
    if (!container) return

    // 本实例的专属宿主：Vditor 的 init 是异步的（i18n / lute 脚本加载完成后才建立内部对象
    // 并把编辑器 DOM 插入宿主，见 vditor/dist/index.js:7120）。React StrictMode 会
    // 「挂载 → 卸载 → 再挂载」，被卸载的旧实例其异步流程仍会往自己的宿主里插 DOM。
    // 若所有实例共用同一个宿主，页面就会残留一个「排在前面且内容为空」的旧编辑器，
    // 表现为 querySelector 拿到空 textarea、用户看到空白正文。
    // 用独立子容器 + 卸载时 remove()，让残留实例的 DOM 落在游离节点上，彻底隔离。
    const mount = document.createElement('div')
    container.appendChild(mount)

    // 本实例是否已作废（卸载或即将重建）：作废实例的异步回调必须全部短路
    let disposed = false

    // 用「最新外部值」初始化：effect 闭包里的 value 可能是过期值
    const initialValue = latestValueRef.current
    // 记录初始值，便于区分外部回填 vs 用户输入
    internalValueRef.current = initialValue
    readyRef.current = false
    const instance = new Vditor(mount, {
      value: initialValue,
      mode,
      height: EDITOR_HEIGHT,
      theme: theme === 'dark' ? 'dark' : 'classic',
      placeholder: '开始写你的文章... 支持拖拽 / 粘贴图片',
      lang: 'zh_CN',
      cache: { enable: false }, // ComposeView 自己管 localStorage，这里关闭
      /**
       * Vditor 初始化完成回调（官方 after 选项，见 vditor/dist/index.js:16296）
       *
       * 场景：编辑草稿时正文由接口异步回填。Vditor 初始化时会用「构造那一刻的 value 快照」
       * 覆盖编辑区（见 vditor/dist/index.js:7213、9496），而接口数据往往晚于该快照，
       * 于是回填内容被冲掉、正文空白，用户会误以为内容丢了。
       * 这里在初始化完成后，以最新的外部值无条件再写一次。
       */
      after: () => {
        // 已作废实例（StrictMode 卸载、切换模式重建）的异步回调直接短路
        if (disposed) return
        readyRef.current = true
        const latest = latestValueRef.current
        internalValueRef.current = latest
        instance.setValue(latest, true)
      },
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
        // 分屏预览延迟按正文长度分级，减少长文的渲染抖动（>5000 字 → 500ms）
        delay: resolvePreviewDelay(initialValue.length),
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
        // 注意：闭包捕获当前 instance，避免切换模式时 instanceRef.current 变 null 影响插入
        handler: ((files: File[]) => handleVditorUpload(files, instance)) as (
          files: File[]
        ) => string | Promise<string> | Promise<null> | null,
        // 自定义 handler 模式下 success / error 回调不会被触发（源码 index.js:6288 只在 XHR 分支调用），
        // 实际错误通过 handler 返回字符串让 Vditor.tip 展示；此处仅为兼容 Vditor 内部兜底
        success: () => undefined,
        error: (msg) => console.error('[MarkdownEditor] 上传错误：', msg),
      },
      input: (v) => {
        // 用户输入触发的值变化：更新内部记录 + 回调外部
        internalValueRef.current = v

        /**
         * ⚠ 关键坑：Vditor 在异步初始化（processAfterRender → textarea input 事件）
         *   阶段也会主动调用一次本回调，此时 this.options 尚未建立，直接读
         *   instance.options.preview.delay 会抛
         *   "Cannot read properties of undefined (reading 'preview')"。
         * 处理策略：
         *   1) disposed：StrictMode 卸载 / 切模式重建后到达的回调直接短路，避免污染已销毁实例；
         *   2) options 判空：初始化时序内 options 可能未就位，跳过动态延迟写入，
         *      此时 Vditor 会沿用 preview.delay 的构造期默认值，行为等价、无副作用；
         *   3) 跨过长度阈值才写回，避免每次按键都触发对象赋值。
         */
        if (!disposed) {
          const nextDelay = resolvePreviewDelay(v.length)
          const vditorOpts = (
            instance as unknown as { options?: { preview: { delay: number } } }
          ).options
          if (vditorOpts && vditorOpts.preview.delay !== nextDelay) {
            vditorOpts.preview.delay = nextDelay
          }
        }

        onChangeRef.current(v)
      },
    })
    instanceRef.current = instance

    // 卸载/重跑时统一在这里销毁，避免 effect 体 + cleanup 双 destroy
    // 用 try/catch 兜底：Vditor 内部 destroy() 未判空 wysiwyg.element，
    // Strict Mode 双挂载或初始化中被打断时会抛 Cannot read properties of undefined
    return () => {
      // 先标记作废：之后到达的异步初始化回调（initUI / after）必须短路
      disposed = true
      readyRef.current = false
      if (instanceRef.current) {
        try {
          instanceRef.current.destroy()
        } catch (err) {
          console.warn('[MarkdownEditor] Vditor 销毁时内部异常（可忽略）：', err)
        } finally {
          instanceRef.current = null
        }
      }
      // 移除本实例的专属宿主：即使已被 destroy 的实例稍后仍往 mount 里插 DOM，
      // 也只是插在游离节点上，不会污染页面
      mount.remove()
    }
  }, [mode, theme])

  // 外部 value 变化时同步到编辑器（编辑旧文章回填、自动保存恢复）
  // 忽略"用户刚输入导致的回调循环"：只有当外部值 != 内部最新值时才 setValue
  useEffect(() => {
    const external = value ?? ''
    if (external === internalValueRef.current) return
    internalValueRef.current = external
    // Vditor 异步初始化未完成时内部 vditor 尚未建立，此时 setValue 会抛异常；
    // 直接跳过即可 —— 初始化完成后的 after 回调会按最新外部值补一次同步
    if (!readyRef.current) return
    instanceRef.current?.setValue(external, true)
  }, [value])

  const tabs: { key: Mode; label: string }[] = [
    { key: 'sv', label: '分屏预览' },
    { key: 'wysiwyg', label: '所见即所得' },
  ]

  return (
    <div className="markdown-editor">
      <div className="markdown-editor__head">
        {label ? <span className="markdown-editor__label">{label}</span> : null}
        <div className="markdown-editor__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`markdown-editor__tab${mode === tab.key ? ' markdown-editor__tab--active' : ''}`}
              onClick={() => setMode(tab.key)}
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
