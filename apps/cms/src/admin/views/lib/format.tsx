/**
 * 列表视图（草稿箱 / 回收站）共用的小格式化与渲染辅助
 */

/** 日期显示统一 YYYY-MM-DD，非法值原样透出 */
export const fmt = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 归一化 Payload 关系字段为名称数组
 * 兼容三形态：数组（对象或裸 id）/ 单对象 / 裸 id
 */
export function extractNames(
  value: Array<{ id: number; name?: string } | number>
    | { id: number; name?: string }
    | number
    | null
    | undefined,
): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'object' ? v.name ?? String(v.id) : String(v)))
      .filter(Boolean)
  }
  if (typeof value === 'object') return [value.name ?? String(value.id)]
  return [String(value)]
}

/** 标签胶囊（空显示占位） */
export const tagPill = (names: string[]) =>
  names.length ? (
    <span className="drafts__tags">
      {names.slice(0, 3).map((n, i) => (
        <i key={`${n}-${i}`} className="drafts__tag">{n}</i>
      ))}
      {names.length > 3 && <i className="drafts__tag drafts__tag--more">+{names.length - 3}</i>}
    </span>
  ) : (
    <span className="drafts__muted">—</span>
  )

/** 正文截取做摘要列兜底 */
export const clip = (text?: string | null, max = 60) => {
  if (!text) return ''
  const plain = text.replace(/[#>*`\-\n]+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
