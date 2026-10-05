'use client'

/**
 * 后台自定义日期控件（不用原生 input[type=date]：浏览器弹层样式与后台观感不统一）
 *
 * - DateField：单值，站点设置「网站创建时间」等字段用
 * - DateRangeField：区间，列表页工具栏用（单框内「开始日期 → 结束日期」+ 一个日历图标）
 *
 * 值一律是 YYYY-MM-DD 文本，空值传空串；面板用 fixed 定位，躲开「卡内滚动」容器的裁剪。
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

// 客户端在首帧绘制前跑（消除弹层闪位），SSR 无 window 时退化为 useEffect 避免告警
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const PANEL_W = 300
const PANEL_H = 384

const pad2 = (n: number) => String(n).padStart(2, '0')
const toDateText = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const parseDateText = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const dpIcon = (paths: ReactNode) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths}
  </svg>
)

const calendarGlyph = dpIcon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </>,
)

/** 打开时：点面板外 / Esc 关闭，并把面板贴到触发框下方（放不下就翻到上方） */
const useFloatingPanel = (open: boolean, close: () => void) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  useIsoLayoutEffect(() => {
    if (!open) return
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow >= PANEL_H + 12 ? r.bottom + 6 : Math.max(12, r.top - PANEL_H - 6)
    const left = Math.min(Math.max(12, r.left), window.innerWidth - PANEL_W - 12)
    setPanelPos({ position: 'fixed', top, left, width: PANEL_W })
  }, [open])

  return { rootRef, panelPos }
}

/** 日历面板：挂载即定位到 value 所在月（无值则当月），所以切换目标时靠 key 重挂载来复位 */
const CalendarPanel = ({
  value,
  onPick,
  style,
}: {
  value: string
  onPick: (text: string) => void
  style?: CSSProperties
}) => {
  const [view, setView] = useState(() => {
    const base = parseDateText(value) ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  // 6 行 × 7 列，前后月补白
  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), 1 - offset + i)
      return { text: toDateText(d), day: d.getDate(), out: d.getMonth() !== view.getMonth() }
    })
  }, [view])

  const todayText = toDateText(new Date())
  const shiftMonth = (delta: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1))
  const shiftYear = (delta: number) => setView((v) => new Date(v.getFullYear() + delta, v.getMonth(), 1))

  return (
    <div className="date-picker" style={style}>
      <div className="date-picker__head">
        <span className="date-picker__nav">
          <button type="button" className="date-picker__nav-btn" onClick={() => shiftYear(-1)} aria-label="上一年">
            {dpIcon(
              <>
                <path d="m11 17-5-5 5-5" />
                <path d="m18 17-5-5 5-5" />
              </>,
            )}
          </button>
          <button type="button" className="date-picker__nav-btn" onClick={() => shiftMonth(-1)} aria-label="上个月">
            {dpIcon(<path d="m15 18-6-6 6-6" />)}
          </button>
        </span>
        <span className="date-picker__title">
          {view.getFullYear()}年 {view.getMonth() + 1}月
        </span>
        <span className="date-picker__nav">
          <button type="button" className="date-picker__nav-btn" onClick={() => shiftMonth(1)} aria-label="下个月">
            {dpIcon(<path d="m9 18 6-6-6-6" />)}
          </button>
          <button type="button" className="date-picker__nav-btn" onClick={() => shiftYear(1)} aria-label="下一年">
            {dpIcon(
              <>
                <path d="m13 17 5-5-5-5" />
                <path d="m6 17 5-5-5-5" />
              </>,
            )}
          </button>
        </span>
      </div>
      <div className="date-picker__weekdays">
        {WEEK_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="date-picker__grid">
        {Array.from({ length: 6 }, (_, w) => (
          <div className="date-picker__week" key={w}>
            {days.slice(w * 7, w * 7 + 7).map((cell) => (
              <button
                type="button"
                key={cell.text}
                className={[
                  'date-picker__day',
                  cell.out && 'date-picker__day--out',
                  cell.text === todayText && 'date-picker__day--today',
                  cell.text === value && 'date-picker__day--selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onPick(cell.text)}
              >
                {cell.day}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="date-picker__foot">
        <button type="button" className="date-picker__foot-btn" onClick={() => onPick(todayText)}>
          今天
        </button>
      </div>
    </div>
  )
}

export const DateField: React.FC<{
  value: string
  onChange: (v: string) => void
  placeholder?: string
}> = ({ value, onChange, placeholder = '请选择日期' }) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const { rootRef, panelPos } = useFloatingPanel(open, close)

  return (
    <div className="date-field" ref={rootRef}>
      <button
        type="button"
        className={`date-field__trigger${open ? ' date-field__trigger--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={value ? 'date-field__text' : 'date-field__placeholder'}>{value || placeholder}</span>
        {calendarGlyph}
      </button>
      {open && (
        <CalendarPanel
          value={value}
          style={panelPos}
          onPick={(text) => {
            onChange(text)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * 日期区间：一个框内「开始日期 → 结束日期」，末尾一个日历图标。
 * 点哪半截就改哪一头；选完开始日期不关面板，直接把目标切到结束日期。
 * 两端互为边界：改开始日期晚于结束日期时清空结束日期（反之同理），避免出现倒挂区间。
 */
export const DateRangeField: React.FC<{
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
}> = ({ from, to, onChange }) => {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<'from' | 'to'>('from')
  const close = () => setOpen(false)
  const { rootRef, panelPos } = useFloatingPanel(open, close)

  const pick = (text: string) => {
    if (target === 'from') {
      onChange({ from: text, to: to && to < text ? '' : to })
      setTarget('to')
      return
    }
    onChange({ from: from && text < from ? '' : from, to: text })
    setOpen(false)
  }

  const half = (key: 'from' | 'to', label: string, value: string) => (
    <button
      type="button"
      className={[
        'range-field__half',
        !value && 'range-field__half--empty',
        open && target === key && 'range-field__half--active',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        setTarget(key)
        setOpen(true)
      }}
    >
      {value || label}
    </button>
  )

  return (
    <div className={`range-field${open ? ' range-field--open' : ''}`} ref={rootRef}>
      {half('from', '开始日期', from)}
      <span className="range-field__sep" aria-hidden="true">
        →
      </span>
      {half('to', '结束日期', to)}
      <button
        type="button"
        className="range-field__icon"
        aria-label="选择日期范围"
        onClick={() => {
          setTarget(from && !to ? 'to' : 'from')
          setOpen((v) => !v)
        }}
      >
        {calendarGlyph}
      </button>
      {open && (
        <CalendarPanel key={target} value={target === 'from' ? from : to} style={panelPos} onPick={pick} />
      )}
    </div>
  )
}

export default DateField
