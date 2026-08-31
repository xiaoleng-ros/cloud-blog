'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { FieldError, FieldLabel, useField, useFieldPath, useTheme } from '@payloadcms/ui'
import type { FieldClientComponent, TextFieldClient } from 'payload'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeLegacyShortcodes from '../lib/rehype-legacy-shortcodes.mjs'
import rehypeImgAttrs from '../lib/rehype-img-attrs.mjs'
import remarkLegacyShortcodes from '../lib/remark-legacy-shortcodes.mjs'
import { markdownPreviewCss } from './markdown-preview-css'

type Mode = 'split' | 'source' | 'preview'

// 复用前台 remark/rehype 插件链，保证与前台渲染结果一致
const renderPreview = (source: string) =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLegacyShortcodes)
    .use(remarkRehype)
    .use(rehypeLegacyShortcodes)
    .use(rehypeImgAttrs)
    .use(rehypeStringify)
    .process(source ?? '')

/**
 * Markdown 编辑器（受控组件，供自定义创作视图使用）
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
  // 跟随 Payload 亮/暗主题，切换 Monaco 配色
  const { theme } = useTheme()
  const [mode, setMode] = useState<Mode>('split')
  const hostRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 将 markdown 渲染为 HTML，注入 shadow DOM（隔离前台全局样式）
  const refreshPreview = useCallback(async (source: string) => {
    const file = await renderPreview(source ?? '')
    const html = String(file)
    const host = hostRef.current
    if (!host) return
    // 判定依据用 shadow root 而非 styleRef：宿主元素在切模式时若被卸载重挂，shadow root 会重建
    if (!host.shadowRoot) {
      const root = host.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = markdownPreviewCss
      styleRef.current = style
      root.appendChild(style)
      const wrap = document.createElement('div')
      wrap.className = 'markdown-preview'
      contentRef.current = wrap
      root.appendChild(wrap)
    }
    contentRef.current!.innerHTML = html
  }, [])

  // 输入防抖 250ms 实时刷新预览
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void refreshPreview(value ?? ''), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, refreshPreview])

  const tabs: { key: Mode; label: string }[] = [
    { key: 'split', label: '分屏' },
    { key: 'source', label: '源码' },
    { key: 'preview', label: '预览' },
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

      {/* 编辑器主体：左右分屏等高；Monaco 高度显式 100%，automaticLayout 保证跟随容器尺寸。
          用 display 显隐而非条件卸载：预览容器 DOM 常驻，shadow DOM 不销毁，切模式后内容仍在 */}
      <div style={{ display: 'flex', gap: '12px', height: '520px' }}>
        <div
          style={{
            flex: mode === 'split' ? 1 : 'none',
            width: mode === 'source' ? '100%' : '50%',
            height: '100%',
            minWidth: 0,
            display: mode === 'preview' ? 'none' : 'block',
          }}
        >
          <Editor
            language="markdown"
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            height="100%"
            value={value ?? ''}
            onChange={(v) => onChange(v ?? '')}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              padding: { top: 12, bottom: 12 },
              fontSize: 13,
              renderLineHighlight: 'none',
              rulers: [],
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
            }}
          />
        </div>
        <div
          ref={hostRef}
          style={{
            flex: 1,
            height: '100%',
            minWidth: 0,
            overflow: 'auto',
            display: mode === 'source' ? 'none' : 'block',
            border: '1px solid var(--theme-elevation-150, #ddd)',
            borderRadius: '8px',
            padding: '16px',
            background: '#fffefb',
          }}
        />
      </div>
    </div>
  )
}

/**
 * Payload 字段版包装：在原生表单中通过 useField 绑定字段路径，
 * 再把受控组件渲染为表单的一环（Posts/Notes 的 content 字段使用）
 */
export const MarkdownEditorField: FieldClientComponent<TextFieldClient> = ({ field }) => {
  // 从表单上下文获取字段路径（官方推荐，兼容所有承载环境）
  const path = useFieldPath()
  // value / setValue 与表单字段 path 双向绑定
  const { value, setValue, showError, errorMessage } = useField<string>({ path })
  // textarea 字段基类自带 label
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