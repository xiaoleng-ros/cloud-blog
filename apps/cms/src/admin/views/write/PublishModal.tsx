'use client'
import { useEffect, useState } from 'react'
import { fetchTerms, type TermOption } from '../lib/api'

/** 发布前的元信息（文章与随笔共用结构，字段按集合取用） */
export interface PublishMeta {
  title: string
  description?: string
  cover?: string
  categoryIds: number[]
  tagIds: number[]
  sticky?: number
  mood?: string
  date?: string
}

interface Props {
  collection: 'posts' | 'notes'
  /** 初始值（编辑/草稿回填） */
  initial: Partial<PublishMeta>
  /** 确认发布回调（meta 为弹窗内收集的元信息） */
  onConfirm: (meta: PublishMeta) => Promise<void>
  /** 关闭弹窗 */
  onCancel: () => void
  /** 提交中状态 */
  saving: boolean
}

/**
 * 发布弹窗：文章（标题/摘要/封面/分类/标签/置顶权重）；随笔（标题/心情/日期/标签）
 */
export const PublishModal: React.FC<Props> = ({ collection, initial, onConfirm, onCancel, saving }) => {
  // 表单状态（初始值来自传入草稿）
  const [title, setTitle] = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [cover, setCover] = useState(initial.cover ?? '')
  const [categoryIds, setCategoryIds] = useState<number[]>(initial.categoryIds ?? [])
  const [tagIds, setTagIds] = useState<number[]>(initial.tagIds ?? [])
  const [sticky, setSticky] = useState<number>(initial.sticky ?? 0)
  const [mood, setMood] = useState(initial.mood ?? '')
  const [date, setDate] = useState(initial.date ?? new Date().toISOString().slice(0, 10))
  // 下拉数据
  const [categories, setCategories] = useState<TermOption[]>([])
  const [tags, setTags] = useState<TermOption[]>([])
  const [error, setError] = useState('')

  // 挂载时拉取分类 / 标签列表（失败不阻塞发布）
  useEffect(() => {
    void Promise.all([fetchTerms('categories'), fetchTerms('tags')])
      .then(([cs, ts]) => {
        setCategories(cs)
        setTags(ts)
      })
      .catch(() => {})
  }, [])

  /** 提交校验并回调 */
  const submit = async () => {
    if (collection === 'posts' && !title.trim()) {
      setError('请填写标题')
      return
    }
    setError('')
    await onConfirm({
      title: title.trim(),
      description: description.trim(),
      cover: cover.trim(),
      categoryIds,
      tagIds,
      sticky,
      mood: mood.trim(),
      date,
    })
  }

  /** 多选下拉组件（分类/标签共用） */
  const multiSelect = (
    options: TermOption[],
    selected: number[],
    onChange: (ids: number[]) => void,
    placeholder: string,
  ) => (
    <select
      className="publish-modal__select"
      multiple
      size={5}
      value={selected.map(String)}
      onChange={(e) => onChange([...e.target.selectedOptions].map((o) => Number(o.value)))}
    >
      {options.length === 0 && <option value="" disabled>{placeholder}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )

  return (
    <div className="publish-modal__mask" onClick={onCancel}>
      <div className="publish-modal" onClick={(e) => e.stopPropagation()}>
        <header className="publish-modal__head">
          <h3 className="publish-modal__title">{collection === 'posts' ? '发布文章' : '发布随笔'}</h3>
          <button type="button" className="publish-modal__close" onClick={onCancel} aria-label="关闭">×</button>
        </header>

        <div className="publish-modal__body">
          <label className="publish-modal__label">{collection === 'posts' ? '标题（必填）' : '标题'}</label>
          <input
            className="publish-modal__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={collection === 'posts' ? '请输入文章标题' : '可选'}
          />

          {collection === 'posts' && (
            <>
              <label className="publish-modal__label">摘要</label>
              <textarea
                className="publish-modal__textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="文章摘要（可选）"
              />
              <label className="publish-modal__label">封面 URL</label>
              <input
                className="publish-modal__input"
                value={cover}
                onChange={(e) => setCover(e.target.value)}
                placeholder="https://…（可选）"
              />
              <label className="publish-modal__label">分类（可多选）</label>
              {multiSelect(categories, categoryIds, setCategoryIds, '暂无分类')}
              <label className="publish-modal__label">置顶权重</label>
              <input
                type="number"
                className="publish-modal__input"
                value={sticky}
                min={0}
                onChange={(e) => setSticky(Number(e.target.value))}
              />
            </>
          )}

          {collection === 'notes' && (
            <>
              <label className="publish-modal__label">心情</label>
              <input
                className="publish-modal__input"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="可选"
              />
              <label className="publish-modal__label">日期</label>
              <input
                type="date"
                className="publish-modal__input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </>
          )}

          <label className="publish-modal__label">标签（可多选）</label>
          {multiSelect(tags, tagIds, setTagIds, '暂无标签')}

          {error && <p className="publish-modal__error">{error}</p>}
        </div>

        <footer className="publish-modal__foot">
          <button type="button" className="publish-modal__btn" onClick={onCancel} disabled={saving}>取消</button>
          <button
            type="button"
            className="publish-modal__btn publish-modal__btn--primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? '提交中…' : collection === 'posts' ? '发布文章' : '发布随笔'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default PublishModal