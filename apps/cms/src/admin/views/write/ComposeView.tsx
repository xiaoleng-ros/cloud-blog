'use client'

/**
 * 通用创作页（写文章 / 写随笔共用，挂载到 /admin/write-post、/admin/write-note）
 *
 * 功能：
 * 1. URL 带 ?id= 时为编辑回填；无 id 为新建
 * 2. 「存草稿」：无 id → POST /api/{collection}（status=draft），有 id → PATCH 更新草稿
 * 3. 「发布」：打开发布弹窗 → 提交 status=published，成功后跳转对应管理列表
 * 4. 自动保存：内容 1 秒防抖写入 localStorage；Ctrl+S 触发存草稿；离开未保存时确认
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownEditor } from '../../../editor/MarkdownEditor'
import {
  createDoc,
  getDoc,
  updateDoc,
  idsOf,
  type AdminNote,
  type AdminPost,
} from '../lib/api'
import { PublishModal, type PublishMeta } from './PublishModal'
import { SlugInput } from './SlugInput'

interface Props {
  collection: 'posts' | 'notes'
  title: string
}

/** localStorage 草稿键（新建为 :new，编辑为 :{id}） */
const STORAGE_KEY = (collection: string, id: string) => `compose:${collection}:${id}`

/** 生成「草稿 日期 时间」式的默认标题（对齐 Ice_blog 空标题草稿命名） */
const defaultDraftTitle = () => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `草稿 ${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`
}

/** 生成唯一 slug（仅新建且未填写标识时兜底） */
const defaultSlug = () => `draft-${Date.now().toString(36)}`

/** 组装提交数据（posts / notes 的差异字段在此合并） */
const buildPayload = (
  collection: 'posts' | 'notes',
  s: {
    title: string
    slug: string
    description: string
    cover: string
    sticky: number
    mood: string
    date: string
    categoryIds: number[]
    tagIds: number[]
    content: string
    status: 'draft' | 'published'
  },
) =>
  collection === 'posts'
    ? {
        title: s.title,
        slug: s.slug,
        description: s.description,
        cover: s.cover,
        sticky: s.sticky,
        categories: s.categoryIds,
        tags: s.tagIds,
        content: s.content,
        status: s.status,
      }
    : {
        title: s.title || undefined,
        mood: s.mood,
        date: s.date,
        tags: s.tagIds,
        content: s.content,
        status: s.status,
      }

export const ComposeView: React.FC<Props> = ({ collection, title }) => {
  const adminRoute = '/admin'
  // 手动解析查询参数（避免 useSearchParams 的 Suspense 约束）
  const id = new URLSearchParams(window.location.search).get('id') ?? null

  const [content, setContent] = useState('')
  const [meta, setMeta] = useState<Partial<PublishMeta>>({})
  const [docSlug, setDocSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishSaving, setPublishSaving] = useState(false)
  // 操作提示（存草稿结果 / 自动保存状态）
  const [saveTip, setSaveTip] = useState('')
  // 未同步改动标记（离开拦截用）
  const dirtyRef = useRef(false)
  // 新建草稿成功后返回的 id（后续保存走更新）
  const createdIdRef = useRef<string | null>(null)
  // 初始内容（自动保存不会覆盖刚回填的内容）
  const initialContentRef = useRef('')

  const currentId = id || createdIdRef.current

  const clearLocal = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY(collection, id || 'new'))
    } catch {
      // 忽略 localStorage 异常
    }
  }, [collection, id])

  // 回填：编辑模式拉详情；新建模式读取本地草稿
  useEffect(() => {
    const load = async () => {
      if (id) {
        setLoading(true)
        try {
          if (collection === 'posts') {
            const doc = await getDoc<AdminPost>('posts', id)
            setContent(doc.content ?? '')
            setDocSlug(doc.slug ?? '')
            setMeta({
              title: doc.title ?? '',
              description: doc.description ?? '',
              cover: doc.cover ?? '',
              categoryIds: idsOf(doc.categories),
              tagIds: idsOf(doc.tags),
              sticky: doc.sticky ?? 0,
            })
          } else {
            const doc = await getDoc<AdminNote>('notes', id)
            setContent(doc.content ?? '')
            setMeta({
              title: doc.title ?? '',
              mood: doc.mood ?? '',
              date: doc.date ? String(doc.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
              tagIds: idsOf(doc.tags),
            })
          }
          initialContentRef.current = ''
          dirtyRef.current = false
        } finally {
          setLoading(false)
        }
      } else {
        // 新建：无内容时回填本地草稿（防止覆盖用户已手动保存的新内容）
        try {
          const local = localStorage.getItem(STORAGE_KEY(collection, 'new'))
          if (local) {
            setContent(local)
            setSaveTip('已恢复本地草稿')
            setTimeout(() => setSaveTip(''), 2500)
          }
        } catch {
          // 忽略 localStorage 异常
        }
      }
    }
    void load()
    dirtyRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, collection])

  // 自动保存：内容变化 1 秒防抖写 localStorage
  useEffect(() => {
    if (content === initialContentRef.current) return
    dirtyRef.current = true
    const timer = setTimeout(() => {
      if (content.trim()) {
        try {
          localStorage.setItem(STORAGE_KEY(collection, id || 'new'), content)
          setSaveTip('已自动保存到本地')
          setTimeout(() => setSaveTip(''), 2000)
        } catch {
          // 忽略 localStorage 异常
        }
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [content, collection, id])

  // Ctrl+S / Cmd+S 触发存草稿（阻止浏览器默认保存页）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void saveDraftRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 离开页面（刷新 / 关闭）未保存确认
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = '您有未保存的内容，确定要离开吗？'
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 存草稿：POST（新建）/ PATCH（更新），status=draft
  const saveDraft = useCallback(async () => {
    if (!content.trim()) {
      setSaveTip('请输入内容')
      setTimeout(() => setSaveTip(''), 2000)
      return
    }
    setLoading(true)
    try {
      // 标题为空时自动命名（新建草稿才生成，编辑保留原标题为空则自动生成一次）
      const titleValue = meta.title?.trim() || defaultDraftTitle()
      // slug 为空时自动生成唯一标识，避免 unique 校验失败
      const slugValue = collection === 'posts' ? (docSlug.trim() || defaultSlug()) : ''
      const payload = buildPayload(collection, {
        title: titleValue,
        slug: slugValue,
        description: meta.description ?? '',
        cover: meta.cover ?? '',
        sticky: meta.sticky ?? 0,
        mood: meta.mood ?? '',
        date: meta.date ?? new Date().toISOString().slice(0, 10),
        categoryIds: meta.categoryIds ?? [],
        tagIds: meta.tagIds ?? [],
        content,
        status: 'draft',
      })
      if (currentId) {
        await updateDoc(collection, currentId, payload)
        setSaveTip('草稿已更新')
      } else {
        const created = await createDoc<{ id: number }>(collection, payload)
        createdIdRef.current = String(created.id)
        setSaveTip('已保存到草稿箱')
      }
      dirtyRef.current = false
      clearLocal()
      setTimeout(() => setSaveTip(''), 2500)
    } catch (error) {
      setSaveTip(`保存失败：${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [collection, content, meta, docSlug, currentId, clearLocal])

  // 用 ref 持有 saveDraft，保证 keydown 监听读到最新闭包
  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  // 发布：提交 status=published，成功后跳转对应管理列表
  const publish = async (m: PublishMeta) => {
    setPublishSaving(true)
    try {
      // 文章 slug 为空时自动生成唯一标识，避免 unique 校验失败
      const finalSlug = collection === 'posts' ? (docSlug.trim() || `post-${Date.now()}`) : ''
      const payload = buildPayload(collection, {
        title: m.title || meta.title || '',
        slug: finalSlug,
        description: m.description ?? '',
        cover: m.cover ?? '',
        sticky: m.sticky ?? 0,
        mood: m.mood ?? '',
        date: m.date ?? new Date().toISOString().slice(0, 10),
        categoryIds: m.categoryIds,
        tagIds: m.tagIds,
        content,
        status: 'published',
      })
      if (currentId) {
        await updateDoc(collection, currentId, payload)
      } else {
        await createDoc(collection, payload)
      }
      clearLocal()
      dirtyRef.current = false
      setPublishOpen(false)
      // 整页跳转到管理列表，保证列表数据刷新
      window.location.assign(`${adminRoute}/collections/${collection}`)
    } catch (error) {
      setPublishSaving(false)
      alert(`发布失败：${(error as Error).message}`)
    }
  }

  return (
    <div className="compose">
      <header className="compose__header">
        <div>
          <p className="compose__eyebrow">{collection === 'posts' ? 'Post' : 'Note'}</p>
          <h1 className="compose__title">{title}</h1>
        </div>
        <div className="compose__actions">
          {saveTip && <span className="compose__tip">{saveTip}</span>}
          <button type="button" className="compose__btn" onClick={() => void saveDraft()} disabled={loading}>
            💾 存草稿
          </button>
          <button
            type="button"
            className="compose__btn compose__btn--primary"
            onClick={() => setPublishOpen(true)}
            disabled={loading}
          >
            🚀 发布
          </button>
        </div>
      </header>

      <div className="compose__body">
        {collection === 'posts' && (
          <div className="compose__meta">
            <label className="compose__meta-label">标题</label>
            <input
              type="text"
              className="compose__meta-title"
              placeholder="文章标题（留空保存时自动命名草稿）"
              value={meta.title ?? ''}
              onChange={(e) => setMeta((prev) => ({ ...prev, title: e.target.value }))}
            />
            <label className="compose__meta-label">文章标识（URL 用）</label>
            <SlugInput value={docSlug} onChange={setDocSlug} />
          </div>
        )}
        <MarkdownEditor value={content} onChange={setContent} label="正文内容（Markdown）" />
      </div>

      {publishOpen && (
        <PublishModal
          collection={collection}
          initial={meta}
          saving={publishSaving}
          onCancel={() => setPublishOpen(false)}
          onConfirm={async (m) => {
            await publish(m)
          }}
        />
      )}
    </div>
  )
}

export default ComposeView