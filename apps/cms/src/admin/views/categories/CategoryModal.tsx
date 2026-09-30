'use client'

/**
 * 分类新建 / 编辑弹窗（分类管理树视图专用）
 *
 * 字段与 Collections/Categories.ts 对齐：名称* / 标识 / 上级分类 / 排序权重 / 前台可见 / 节点类型。
 * 上级分类选项按树形缩进展示，并排除自身及其后代（防成环；后端 beforeChange 还有兜底守卫）。
 */
import { useMemo, useState } from 'react'
import { createCategory, updateCategory, type CategoryDoc } from '../lib/api'

export const parentIdOf = (d: CategoryDoc): number | null => {
  if (d.parent == null) return null
  return typeof d.parent === 'object' ? Number(d.parent.id) : Number(d.parent)
}

const NODE_TYPES = [
  { value: 'category', label: '分类', hint: '归档文章' },
  { value: 'page', label: '页面', hint: '站内页面' },
  { value: 'nav', label: '导航', hint: '外链跳转' },
] as const

type NodeType = (typeof NODE_TYPES)[number]['value']

/** 把全量分类拍平成「树形顺序 + 深度」列表，供上级分类下拉；excludeId 子树整体剔除 */
export function flattenWithDepth(docs: CategoryDoc[], excludeId?: number) {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const childMap = new Map<number, CategoryDoc[]>()
  const roots: CategoryDoc[] = []
  const cmp = (a: CategoryDoc, b: CategoryDoc) =>
    (Number(a.sort ?? 0) - Number(b.sort ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh')

  for (const d of docs) {
    const p = parentIdOf(d)
    if (p == null || !byId.has(p)) roots.push(d)
    else childMap.set(p, [...(childMap.get(p) ?? []), d])
  }
  const out: { doc: CategoryDoc; depth: number }[] = []
  const walk = (list: CategoryDoc[], depth: number) => {
    for (const d of [...list].sort(cmp)) {
      if (excludeId != null && d.id === excludeId) continue
      out.push({ doc: d, depth })
      walk(childMap.get(d.id) ?? [], depth + 1)
    }
  }
  walk(roots, 0)
  return out
}

export function CategoryModal({
  mode,
  initial,
  docs,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial?: CategoryDoc
  docs: CategoryDoc[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [parent, setParent] = useState<string>(initial && parentIdOf(initial) != null ? String(parentIdOf(initial)) : '')
  const [sort, setSort] = useState<string>(String(initial?.sort ?? 0))
  const [visible, setVisible] = useState<boolean>(initial?.visible !== false)
  const [nodeType, setNodeType] = useState<NodeType>(initial?.nodeType ?? 'category')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const parentOptions = useMemo(
    () => (mode === 'edit' && initial ? flattenWithDepth(docs, initial.id) : flattenWithDepth(docs)),
    [docs, mode, initial],
  )

  const submit = async () => {
    if (!name.trim()) {
      setError('请填写分类名称')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      name: name.trim(),
      slug: slug.trim() || null,
      nodeType,
      parent: parent ? Number(parent) : null,
      sort: Number(sort) || 0,
      visible,
    }
    try {
      if (mode === 'create') await createCategory(payload)
      else if (initial) await updateCategory(initial.id, payload)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="drafts__confirm-mask" onClick={onClose}>
      <div className="cat__modal" onClick={(e) => e.stopPropagation()}>
        <header className="cat__modal-head">
          <span className="cat__modal-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2 2 7l10 5 10-5-10-5Z" />
              <path d="m2 17 10 5 10-5" />
              <path d="m2 12 10 5 10-5" />
            </svg>
          </span>
          <div>
            <h3>{mode === 'create' ? '新建分类' : '编辑分类'}</h3>
            <p>支持多级分类、页面与导航模式，用于组织文章与站点菜单</p>
          </div>
          <button type="button" className="cat__modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="cat__form">
          <div className="cat__row2">
            <label className="cat__field">
              <span className="cat__label">分类名称</span>
              <input
                className="cat__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：技术随笔"
              />
            </label>
            <label className="cat__field">
              <span className="cat__label">分类标识</span>
              <input
                className="cat__input"
                value={slug ?? ''}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="例如：tech"
              />
            </label>
          </div>

          <div className="cat__row2">
            <label className="cat__field">
              <span className="cat__label">
                上级分类 <i>（可选）</i>
              </span>
              <select className="cat__input" value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">一级分类</option>
                {parentOptions.map(({ doc, depth }) => (
                  <option key={doc.id} value={doc.id}>
                    {'　'.repeat(depth)}
                    {depth > 0 ? '└ ' : ''}
                    {doc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cat__field">
              <span className="cat__label">
                排序权重 <i>（可选）</i>
              </span>
              <input
                className="cat__input"
                type="number"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          <div className="cat__field">
            <span className="cat__label">
              前台可见 <i>（可选）</i>
            </span>
            <div className="cat__segmented" role="radiogroup" aria-label="前台可见">
              <button
                type="button"
                role="radio"
                aria-checked={visible}
                className={`cat__seg${visible ? ' cat__seg--active' : ''}`}
                onClick={() => setVisible(true)}
              >
                显示
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!visible}
                className={`cat__seg${!visible ? ' cat__seg--active' : ''}`}
                onClick={() => setVisible(false)}
              >
                隐藏
              </button>
            </div>
          </div>

          <div className="cat__field">
            <span className="cat__label">
              节点类型 <i>（可选）</i>
            </span>
            <div className="cat__types" role="radiogroup" aria-label="节点类型">
              {NODE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={nodeType === t.value}
                  className={`cat__type-card${nodeType === t.value ? ' cat__type-card--active' : ''}`}
                  onClick={() => setNodeType(t.value)}
                >
                  <b>{t.label}</b>
                  <i>{t.hint}</i>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="cat__error">{error}</p>}
        </div>

        <footer className="cat__modal-foot">
          <button type="button" className="cat__btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="cat__btn cat__btn--primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '保存中…' : mode === 'create' ? '+ 新增分类' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default CategoryModal
