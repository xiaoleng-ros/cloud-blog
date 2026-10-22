'use client'
import { useEffect, useRef, useState } from 'react'
import type { TermOption } from '../views/lib/api'

/**
 * 标签选择器（细长输入框 + 展开式标签卡片）
 *
 * 形态：一个描边框，左边是可自由输入的文本框（标签名用顿号分隔），右边「选择」按钮。
 * 点「选择」在框下方就地展开卡片，列出全部已有标签，勾选即写入文本框。
 *
 * 为什么卡片走「文档流内展开」而不是浮层：发布弹窗 body 是 overflow-y:auto 的滚动容器，
 * 浮层要么被裁掉、要么在视口偏矮时被迫向上翻盖住分类/置顶等字段（实测位置错乱）。
 * 就地展开永远贴在输入框正下方，也不会遮挡其它字段。
 *
 * 关键设计：**文本框才是唯一数据源**。
 *   - 勾选卡片 → 把标签名追加/移除到文本
 *   - 手打新名字 → 提交时由上层按名字匹配已有标签，匹配不到就建新标签入库
 * 这样「选已有」和「造新的」走同一条通道，不需要两套状态互相同步。
 */
export interface TagPickerProps {
  /** 全部已有标签（只用于卡片展示与「是否已存在」判断） */
  options: TermOption[]
  /** 已选/已输入的标签文本，顿号分隔 */
  text: string
  /** 文本变化回调（输入、勾选、清空都走这里） */
  onTextChange: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

/** 拆分标签文本：顿号为主，兼容全/半角逗号与换行；去空白、去重、保序 */
export const splitTagText = (raw: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[、，,\n\r]+/)) {
    const v = piece.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export const TagPicker: React.FC<TagPickerProps> = ({
  options,
  text,
  onTextChange,
  disabled,
  placeholder = '请选择或输入标签',
}) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 点外部 / Esc 关闭卡片
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 展开后把卡片滚进可视区（弹窗 body 内部滚动，block:'nearest' 只动最近的可滚动祖先）
  useEffect(() => {
    if (!open) return
    popRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  const names = splitTagText(text)
  const isOn = (o: TermOption) => names.includes(String(o.name))

  /** 勾选 / 取消：把标签名写进文本（保持已有顺序，取消时移除该名字） */
  const toggle = (o: TermOption) => {
    const name = String(o.name)
    const next = names.includes(name) ? names.filter((n) => n !== name) : [...names, name]
    onTextChange(next.join('、'))
  }

  return (
    <div className="tag-picker" ref={rootRef}>
      {/* 单框：可输入文本框 + 「选择」按钮，外观对齐封面图输入框 */}
      <div className={`tag-picker__combo${open ? ' tag-picker__combo--open' : ''}`}>
        <svg
          className="tag-picker__combo-glyph"
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
          <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.9l7.7 7.7a2 2 0 0 1 0 2.8Z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
        <input
          type="text"
          className="tag-picker__input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          // 不在聚焦时自动展开：卡片是文档流内展开的，会顶动下面的分类/置顶字段，
          // 纯粹想打几个新标签名时反而是干扰。展开只走右侧「选择」按钮。
          placeholder={placeholder}
          disabled={disabled}
          aria-label="标签，多个用顿号隔开"
        />
        <button
          type="button"
          className="tag-picker__combo-btn"
          // 输入框聚焦不再自动展开，所以这里做成 toggle：点一次展开、再点一次收起
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-expanded={open}
        >
          {names.length > 0 && <span className="tag-picker__count">{names.length}</span>}
          选择
        </button>
      </div>

      {/* 展开卡片：贴在框正下方（文档流内），已有标签勾选 */}
      {open && (
        <div className="tag-picker__pop" ref={popRef} role="dialog" aria-label="选择标签">
          <div className="tag-picker__pop-head">
            <span className="tag-picker__pop-title">已有标签</span>
            <span className="tag-picker__pop-actions">
              {names.length > 0 && (
                <button type="button" className="tag-picker__clear" onClick={() => onTextChange('')}>
                  清空
                </button>
              )}
              <button type="button" className="tag-picker__close" onClick={() => setOpen(false)} aria-label="收起">
                ×
              </button>
            </span>
          </div>

          <div className="tag-picker__pop-body">
            {options.length === 0 ? (
              <p className="tag-picker__empty">还没有标签，直接在框里输入即可新建</p>
            ) : (
              options.map((o) => {
                const checked = isOn(o)
                return (
                  <label key={o.id} className={`tag-picker__item${checked ? ' tag-picker__item--on' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(o)} />
                    <span className="tag-picker__item-name">{o.name}</span>
                  </label>
                )
              })
            )}
          </div>

          <p className="tag-picker__tip">没有想要的？直接在框里输入，用顿号（、）隔开，提交时自动新建</p>
        </div>
      )}
    </div>
  )
}

export default TagPicker
