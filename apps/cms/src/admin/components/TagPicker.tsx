'use client'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { TermOption } from '../views/lib/api'

/**
 * 标签选择器（细长框 + 弹出卡片多选）
 *
 * 结构复刻 CoverUploader 的 combo 单框：左边显示已选标签（顿号分隔），
 * 右边「选择」按钮；点开后弹出小卡片列出全部标签，勾选即可多选。
 *
 * 为什么不直接用 <select multiple>：原生多选列表要按住 Ctrl 点选，且占 5 行高度，
 * 在发布弹窗里既占地方又反直觉；弹出卡片用复选框，点一下就是一个，符合「可多选」的字面意思。
 *
 * 弹层用 fixed 定位（与 DateField 同法）：发布弹窗 body 是 overflow-y:auto 的滚动容器，
 * 绝对定位会随卡片一起被裁掉。
 *
 * @param options  全部可选标签
 * @param selected 已选标签 id
 * @param onChange 选择变化回调（顺序按 options 顺序归一，避免抖动）
 * @param disabled 禁用（发布中）
 * @param placeholder 无选中时的占位文案
 */
export interface TagPickerProps {
  options: TermOption[]
  selected: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  placeholder?: string
}

const PANEL_W = 260
const PANEL_MAX_H = 300

// 客户端在首帧绘制前跑（消除弹层闪位），SSR 无 window 时退化为 useEffect 避免告警
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** 已选标签按 options 顺序排列，显示文案用顿号连接 */
const joinNames = (options: TermOption[], ids: number[]) =>
  options
    .filter((o) => ids.includes(Number(o.id)))
    .map((o) => String(o.name))
    .join('、')

export const TagPicker: React.FC<TagPickerProps> = ({
  options,
  selected,
  onChange,
  disabled,
  placeholder = '请选择标签',
}) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  // 点外部 / Esc 关闭卡片。弹层是 fixed 定位、不在 rootRef 内，所以要单独放行
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
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

  // 定位：默认贴框下方，放不下翻到上方；左右夹在视口内
  useIsoLayoutEffect(() => {
    if (!open) return
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow >= PANEL_MAX_H + 12 ? r.bottom + 6 : Math.max(12, r.top - PANEL_MAX_H - 6)
    const left = Math.min(Math.max(12, r.left), window.innerWidth - PANEL_W - 12)
    setPanelPos({ position: 'fixed', top, left, width: PANEL_W })
  }, [open])

  const text = useMemo(() => joinNames(options, selected), [options, selected])

  const toggle = (id: number) => {
    const has = selected.includes(id)
    const next = has ? selected.filter((v) => v !== id) : [...selected, id]
    // 归一成 options 顺序：勾选顺序不影响最终展示与提交内容
    onChange(options.filter((o) => next.includes(Number(o.id))).map((o) => Number(o.id)))
  }

  return (
    <div className="tag-picker" ref={rootRef}>
      {/* 单框：已选标签文本 + 「选择」按钮，外观对齐封面图输入框 */}
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
        <button
          type="button"
          className={`tag-picker__display${text ? '' : ' tag-picker__display--empty'}`}
          onClick={() => !disabled && setOpen((v) => !v)}
          disabled={disabled}
          title={text || placeholder}
          aria-expanded={open}
        >
          {text || placeholder}
        </button>
        <button
          type="button"
          className="tag-picker__combo-btn"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
        >
          {selected.length > 0 && <span className="tag-picker__count">{selected.length}</span>}
          选择
        </button>
      </div>

      {/* 弹出卡片：全部标签的复选框列表 */}
      {open && (
        <div className="tag-picker__pop" style={panelPos} ref={panelRef} role="dialog" aria-label="选择标签">
          <div className="tag-picker__pop-head">
            <span>选择标签</span>
            {selected.length > 0 && (
              <button type="button" className="tag-picker__clear" onClick={() => onChange([])}>
                清空
              </button>
            )}
          </div>
          <div className="tag-picker__pop-body">
            {options.length === 0 ? (
              <p className="tag-picker__empty">还没有标签，先去标签管理页创建</p>
            ) : (
              options.map((o) => {
                const id = Number(o.id)
                const checked = selected.includes(id)
                return (
                  <label key={id} className={`tag-picker__item${checked ? ' tag-picker__item--on' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                    <span className="tag-picker__item-name">{o.name}</span>
                  </label>
                )
              })
            )}
          </div>
          <div className="tag-picker__pop-foot">
            <button type="button" className="tag-picker__done" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TagPicker
