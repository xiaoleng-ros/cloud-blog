'use client'
import { useEffect, useRef, useState } from 'react'
import { formatDate } from 'cloud-blog/shared/post-utils'
import { CoverUploader } from '../../components/CoverUploader'
import { DateField } from '../../components/DateField'
import { TagPicker, splitTagText } from '../../components/TagPicker'
import { createTerm, fetchSelectableCategories, fetchTerms, type TermOption } from '../lib/api'

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
  /** 弹窗用途：'publish' 走完发布校验；'draft' 只为存草稿收集元信息（标题可留空，分类仍必填） */
  mode?: 'publish' | 'draft'
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
 * 元信息弹窗：文章（标题/摘要/封面/分类/标签/置顶权重）；随笔（标题/心情/日期/标签）
 */
export const PublishModal: React.FC<Props> = ({
  collection,
  mode = 'publish',
  initial,
  onConfirm,
  onCancel,
  saving,
}) => {
  const isDraft = mode === 'draft'
  // 表单状态（初始值来自传入草稿）
  const [title, setTitle] = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [cover, setCover] = useState(initial.cover ?? '')
  const [categoryIds, setCategoryIds] = useState<number[]>(initial.categoryIds ?? [])
  // 标签走「文本框唯一数据源」：勾选卡片只是把名字写进这段文本，手打新名字也写进这里。
  // 真正的 id 解析（含新建缺失标签）留到 submit 时做，避免边打字边建标签。
  const [tagText, setTagText] = useState('')
  // 用户是否动过标签框：用于「编辑旧文时标签列表没拉回来」的兜底——
  // 没动过就沿用 initial.tagIds，绝不因为一次网络抖动把文章的标签清空
  const tagTouchedRef = useRef(false)
  const [sticky, setSticky] = useState<number>(initial.sticky ?? 0)
  const [mood, setMood] = useState(initial.mood ?? '')
  // 默认日期用 Asia/Shanghai 现成工具，避免上海 00:00–08:00 时 toISOString 仍取 UTC 前一天
  const [date, setDate] = useState(initial.date ?? formatDate(new Date()))
  // 下拉数据
  const [categories, setCategories] = useState<TermOption[]>([])
  const [tags, setTags] = useState<TermOption[]>([])
  const [error, setError] = useState('')

  // 挂载时拉取分类 / 标签列表（失败不阻塞发布）；分类只列「类型=分类且前台可见」的节点
  // 标签拉回后再把 initial.tagIds 翻译成标签名填进文本框：ids→names 需要 name，只能等列表到位
  const tagsReadyRef = useRef(false)
  useEffect(() => {
    void Promise.all([fetchSelectableCategories(), fetchTerms('tags')])
      .then(([cs, ts]) => {
        setCategories(cs)
        setTags(ts)
        tagsReadyRef.current = true
        const preset = initial.tagIds?.length
          ? ts.filter((t) => initial.tagIds?.includes(Number(t.id))).map((t) => String(t.name))
          : []
        // 只做一次回填，且不覆盖用户已经在框里敲的内容
        if (preset.length > 0) setTagText((cur) => (cur.trim() ? cur : preset.join('、')))
      })
      .catch(() => {})
    // initial 只在挂载时读一次，故不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 把文本框里的标签名解析成 id：已有标签按名字匹配，匹配不到的自动新建入库
   *
   * 这样用户手打的标签会真正落到 tags 集合里，标签管理页也能看到，
   * 而不是像以前那样只能在已有标签里挑。
   */
  const resolveTagIds = async (text: string): Promise<number[]> => {
    const names = splitTagText(text)
    if (names.length === 0) return []
    // 标签列表还没回来（首屏点太快）就先补拉一次，否则会把已有标签误判成新的重复建
    let pool = tags
    if (!tagsReadyRef.current) {
      try {
        pool = await fetchTerms('tags')
        setTags(pool)
        tagsReadyRef.current = true
      } catch {
        // 拉不到就用现有 pool 尽力匹配
      }
    }
    const byName = new Map(pool.map((t) => [String(t.name), Number(t.id)]))
    const ids: number[] = []
    const created: TermOption[] = []
    for (const name of names) {
      const hit = byName.get(name)
      if (hit) {
        ids.push(hit)
        continue
      }
      const term = await createTerm('tags', name)
      byName.set(name, Number(term.id))
      created.push(term)
      ids.push(Number(term.id))
    }
    if (created.length > 0) setTags((prev) => [...prev, ...created])
    return ids
  }

  /** 提交校验并回调 */
  const submit = async () => {
    if (!isDraft && collection === 'posts' && !title.trim()) {
      setError('请填写标题')
      return
    }
    // 分类必填（草稿也一样）：数据库里 posts/notes.categories_id 是 NOT NULL，
    // 而且文章 URL 由「分类名/ID」拼接，缺了分类后端直接 400
    if (categoryIds.length === 0) {
      setError('请选择分类（必填，决定文章链接）')
      return
    }
    setError('')
    // 标签名 → id（缺的现建）：失败要拦住，否则正文会带着「半个标签集」发出去
    let tagIds: number[]
    try {
      tagIds = await resolveTagIds(tagText)
    } catch (e) {
      setError(`标签保存失败：${e instanceof Error ? e.message : '未知错误'}`)
      return
    }
    // 兜底：编辑旧文时如果标签列表没拉回来、文本框又一直是空的（用户没动过），
    // 沿用原有的 tagIds，避免一次网络抖动就把文章标签洗成空
    if (!tagTouchedRef.current && tagText.trim() === '' && initial.tagIds?.length) {
      tagIds = initial.tagIds
    }
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

  /**
   * 单选下拉组件（用于分类：文章与随笔都只能选一个分类，因为分类决定 URL）
   *
   * 单选后把 ids 数组只保留一个元素，保持 PublishMeta.categoryIds 结构不变，
   * 避免影响 buildPayload 的下游取值逻辑。
   */
  const singleSelect = (
    options: TermOption[],
    selected: number[],
    onChange: (ids: number[]) => void,
    placeholder: string,
  ) => (
    <select
      className={`publish-modal__input publish-modal__select--single${selected[0] ? '' : ' publish-modal__select--empty'}`}
      value={String(selected[0] ?? '')}
      onChange={(e) => {
        const v = e.target.value
        onChange(v ? [Number(v)] : [])
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )

  return (
    <div className="publish-modal__mask" onClick={onCancel}>
      <div className="publish-modal" onClick={(e) => e.stopPropagation()}>
        <header className="publish-modal__head">
          <h3 className="publish-modal__title">
            {isDraft ? '存草稿' : collection === 'posts' ? '发布文章' : '发布随笔'}
          </h3>
          <button type="button" className="publish-modal__close" onClick={onCancel} aria-label="关闭">×</button>
        </header>

        <div className="publish-modal__body">
          <label className="publish-modal__label">
            {!isDraft && collection === 'posts' ? '标题（必填）' : '标题'}
          </label>
          <input
            className="publish-modal__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isDraft ? '可留空，自动按日期命名' : collection === 'posts' ? '请输入文章标题' : '可选'}
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
              <label className="publish-modal__label">封面图</label>
              {/* 复用 CoverUploader：与 Payload 原生编辑页的 cover 字段共用同一套 UI */}
              <CoverUploader value={cover} onChange={setCover} disabled={saving} placeholder="请输入封面地址" />
              <label className="publish-modal__label">文章分类（必填）</label>
              {singleSelect(categories, categoryIds, setCategoryIds, '请选择分类（必填）')}
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
              <label className="publish-modal__label">文章分类（必填）</label>
              {singleSelect(categories, categoryIds, setCategoryIds, '请选择分类（必填）')}
              <label className="publish-modal__label">心情</label>
              <input
                className="publish-modal__input"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="可选"
              />
              <label className="publish-modal__label">日期</label>
              <DateField value={date} onChange={setDate} placeholder="选择日期" />
            </>
          )}

          <label className="publish-modal__label">标签（可多选，也可新建）</label>
          {/* TagPicker：细长框可自由输入（顿号分隔）+ 右侧「选择」就地展开卡片勾选 */}
          <TagPicker
            options={tags}
            text={tagText}
            onTextChange={(v) => {
              tagTouchedRef.current = true
              setTagText(v)
            }}
            disabled={saving}
            placeholder="请选择标签，或直接输入（顿号分隔）"
          />

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
            {saving
              ? '提交中…'
              : isDraft
                ? '保存草稿'
                : collection === 'posts'
                  ? '发布文章'
                  : '发布随笔'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default PublishModal