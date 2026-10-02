'use client'

/**
 * 导航管理整页自定义视图（root 替换 Payload 内置全局编辑页）
 *
 * 与站点设置同一套版式：PageHeader（标题+描述在横线上方）+ 居中单卡片，
 * 卡片内为导航项行编辑器（序号 + 文字 + 链接 + 上移/下移/删除），底部整宽绿色保存。
 * 数据 GET/PATCH /api/globals/navigation，底层仍是「文字 链接」逐行文本。
 */
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { fetchGlobal, updateGlobal } from '../lib/api'

/** 单条导航项 */
interface NavItem {
  label: string
  href: string
}

/**
 * 解析「文字 链接」逐行文本（宽松版）
 * - 无空格的行：整行视为文字，链接待填写（编辑中间态）
 * - 用最后一个空格切分，文字可含空格（链接不含空格）
 */
function parseNavItems(raw?: string | null): NavItem[] {
  if (!raw) return []
  const out: NavItem[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.lastIndexOf(' ')
    if (sp === -1) {
      out.push({ label: trimmed, href: '' })
      continue
    }
    const label = trimmed.slice(0, sp).trim()
    const href = trimmed.slice(sp + 1).trim()
    if (label) out.push({ label, href })
  }
  return out
}

/** 序列化为「文字 链接」逐行文本；链接为空仅写文字 */
function stringifyNavItems(items: NavItem[]): string {
  return items
    .filter((item) => item.label)
    .map((item) => (item.href.trim() ? `${item.label.trim()} ${item.href.trim()}` : item.label.trim()))
    .join('\n')
}

export const NavigationEditView = () => {
  const [items, setItems] = useState<NavItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const doc = await fetchGlobal<{ navItems?: string | null }>('navigation')
        if (alive) setItems(parseNavItems(doc?.navItems))
      } catch {
        if (alive) setError('导航配置加载失败，请刷新重试')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const replace = useCallback((next: NavItem[]) => {
    setItems(next)
    setSaved(false)
  }, [])

  const updateItem = (index: number, item: NavItem) =>
    replace(items.map((it, i) => (i === index ? item : it)))

  const removeItem = (index: number) => replace(items.filter((_, i) => i !== index))

  const addItem = () => replace([...items, { label: '', href: '' }])

  const moveItem = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    replace(next)
  }

  const save = async () => {
    if (items.some((it) => it.label.trim() && !it.href.trim())) {
      setError('存在填写了文字但未填链接的导航项，请补全后再保存')
      return
    }
    setBusy(true)
    setError('')
    try {
      await updateGlobal<unknown>('navigation', { navItems: stringifyNavItems(items) })
      setItems(parseNavItems(stringifyNavItems(items)))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings">
      <PageHeader title="导航管理" />

      <div className="settings__layout settings__layout--single">
        <section className="settings__panel">
          <h2 className="settings__panel-title">导航项</h2>

          {loading ? (
            <p className="drafts__empty">加载中…</p>
          ) : (
            <div className="nav-items-field__list">
              {items.length === 0 && (
                <div className="nav-items-field__empty">
                  还没有导航项，点击下方按钮添加一条。
                </div>
              )}
              {items.map((item, index) => (
                <div className="nav-items-field__row" key={index}>
                  <span className="nav-items-field__index">{index + 1}</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => updateItem(index, { ...item, label: e.target.value })}
                    placeholder="导航文字，如：首页"
                    className="nav-items-field__text"
                  />
                  <input
                    type="text"
                    value={item.href}
                    onChange={(e) => updateItem(index, { ...item, href: e.target.value })}
                    placeholder="/ 或 /archive/"
                    className="nav-items-field__input"
                  />
                  <div className="nav-items-field__ops">
                    <button
                      type="button"
                      onClick={() => moveItem(index, -1)}
                      disabled={index === 0}
                      className="nav-items-field__move"
                      aria-label="上移"
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, 1)}
                      disabled={index === items.length - 1}
                      className="nav-items-field__move"
                      aria-label="下移"
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="nav-items-field__remove"
                      aria-label="删除此导航项"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={addItem} className="nav-items-field__add">
            + 添加导航项
          </button>

          <p className="nav-items-field__hint">
            每条为一个「文字 链接」，用 ↑ ↓ 调整顺序，前台顶部导航按从上到下展示。链接支持相对路径（如{' '}
            <code>/archive/</code>）或完整网址。
          </p>

          {error && <p className="settings__error">{error}</p>}

          <button
            type="button"
            className="settings__submit"
            disabled={loading || busy}
            onClick={() => void save()}
          >
            {busy ? '保存中…' : saved ? '已保存 ✓' : '保存'}
          </button>
        </section>
      </div>
    </div>
  )
}

export default NavigationEditView
