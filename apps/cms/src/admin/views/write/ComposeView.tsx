'use client'

/**
 * 通用创作页（写文章 / 写随笔共用，挂载到 /admin/write-post、/admin/write-note）
 *
 * 功能：
 * 1. URL 带 ?id= 时为编辑回填；无 id 为新建
 * 2. 「存草稿」：无 id → POST /api/{collection}（status=draft），有 id → PATCH 更新草稿
 * 3. 「发布」：打开发布弹窗 → 提交 status=published，成功后跳转对应管理列表
 * 4. 自动保存：内容 1 秒防抖写入 localStorage；Ctrl+S 触发存草稿；离开未保存时确认
 *
 * URL 生成方式：所有文章/随笔的 URL 统一由「分类名 / 数据库自增 id」拼接，
 * 后台不再有 slug 字段，用户只需选择分类即可。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDate } from 'cloud-blog/shared/post-utils'
import { MarkdownEditor } from '../../../editor/MarkdownEditor'
import { PageHeader } from '../../components/PageHeader'
import {
  ApiError,
  createDoc,
  getDoc,
  updateDoc,
  idsOf,
  type AdminNote,
  type AdminPost,
} from '../lib/api'
import { PublishModal, type PublishMeta } from './PublishModal'
import { buildPayload, defaultDraftTitle } from './compose-utils'

interface Props {
  collection: 'posts' | 'notes'
  title: string
}

/** localStorage 草稿键（新建为 :new，编辑为 :{id}） */
const STORAGE_KEY = (collection: string, id: string) => `compose:${collection}:${id}`

/**
 * 把 API 抛出的错误映射成给用户看的友好提示
 *
 * 处理重点：401（未登录/会话过期）与 403（登录但无权限）必须给出明确文案，
 * 避免用户看到模糊的「无权执行此操作」而误以为内容丢失（内容其实没丢，本地草稿还在）。
 *
 * @param error 调用方捕获到的错误对象
 * @returns 中文提示文案
 */
const describeApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已过期，请重新登录（本地草稿未丢失）'
    if (error.status === 403) return '无操作权限，请确认当前账号是否已授权（内容仍在本地）'
    if (error.status === 429) return '操作过于频繁，请稍后重试'
    // 5xx：不回显状态码/原始信息，统一通用文案
    if (error.status >= 500) return '操作失败，请稍后重试'
    // 其余 4xx（含后端 APIError 抛出的中文业务提示）保留展示
    return error.message
  }
  // 非 Payload 错误（网络抖动等）：通用文案，不把 String(err) 原样抛出
  return '操作失败，请稍后重试'
}

export const ComposeView: React.FC<Props> = ({ collection, title }) => {
  const adminRoute = '/admin'
  // 手动解析查询参数（避免 useSearchParams 的 Suspense 约束）
  //
  // ⚠ 关键坑：不能在渲染期（含 useState 惰性初始化）读取 window.location.search。
  //   Next.js 客户端导航（如从草稿箱点「编辑」跳进来）时，URL 的 pushState 发生在
  //   页面渲染之后，而惰性初始化只在首次渲染执行一次 —— 读到的是上一个页面的 search，
  //   于是 id 永远为 null，走「新建」分支，表现为草稿内容全部不回填。
  //
  //   因此改为在 effect 中读取：effect 里先读一次（硬刷新场景 URL 已是新值），
  //   再用 setTimeout(0) 兜底读一次（客户端导航场景此时 URL 必然已更新）。
  // 状态语义：undefined = 尚未解析完成，null = 新建，string = 编辑既有文档
  const [id, setId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const readId = () => {
      const next = new URLSearchParams(window.location.search).get('id')
      setId((prev) => (prev === next ? prev : next))
    }
    readId()
    const timer = setTimeout(readId, 0)
    return () => clearTimeout(timer)
  }, [])

  const [content, setContent] = useState('')
  const [meta, setMeta] = useState<Partial<PublishMeta>>({})
  const [loading, setLoading] = useState(false)
  // 元信息弹窗：null=关闭，'publish'=发布弹窗，'draft'=仅为存草稿补选分类/元信息
  const [modal, setModal] = useState<null | 'publish' | 'draft'>(null)
  const [publishSaving, setPublishSaving] = useState(false)
  // 操作提示（存草稿结果 / 自动保存状态）
  const [saveTip, setSaveTip] = useState('')
  // 未同步改动标记（离开拦截用）
  const dirtyRef = useRef(false)
  // 新建草稿成功后返回的 id（后续保存走更新）
  // 用 state 而非 ref：让下面的自动保存/清理 effect 在拿到 id 后能自动重跑，
  // 从而把 storageKey 从 :new 切换到 :{newId}，防止后续元信息改动仍写到 :new 键。
  const [createdId, setCreatedId] = useState<string | null>(null)
  // createdId 的同步镜像：新建成功后立即可读，避免同一渲染周期内的并发提交读到旧值而建出两份文档
  const createdIdRef = useRef<string | null>(null)
  // 提交互斥锁：存草稿 / 发布 期间为 true，杜绝重复提交（含 Ctrl+S 连击、草稿与发布并发）
  const submittingRef = useRef(false)
  // 回填失败错误态（编辑模式拉详情失败时展示，并提供重试）
  const [loadError, setLoadError] = useState('')
  // 初始内容（自动保存不会覆盖刚回填的内容）
  const initialContentRef = useRef('')
  // 是否已回填完成（自动保存在回填完成前不写入，避免覆盖刚拉回的草稿）
  const loadedRef = useRef(false)

  // 当前文档 id：URL id 优先，其次新建后返回的 id
  const currentId = id || createdId

  // localStorage 键：跟随 currentId 切换，首次存草稿后 :new → :{newId}
  const storageKey = STORAGE_KEY(collection, currentId || 'new')

  const clearLocal = useCallback(() => {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // 忽略 localStorage 异常
    }
  }, [storageKey])

  // 回填：编辑模式拉详情；新建模式读取本地草稿
  // 抽成 useCallback，便于回填失败时点「重试」重新拉取。
  const load = useCallback(async () => {
    // id 还没从 URL 解析出来：先不加载，避免误走「新建」分支把本地草稿填进来
    if (id === undefined) return
    loadedRef.current = false
    setLoadError('')
    if (id) {
      setLoading(true)
      try {
        if (collection === 'posts') {
          const doc = await getDoc<AdminPost>('posts', id)
          setContent(doc.content ?? '')
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
            date: doc.date ? String(doc.date).slice(0, 10) : formatDate(new Date()),
            categoryIds: idsOf(doc.categories),
            tagIds: idsOf(doc.tags),
          })
        }
        initialContentRef.current = ''
        dirtyRef.current = false
      } catch (error) {
        // 回填失败（401/404/5xx 等）：给出可见错误态 + 重试，不再静默留白
        setLoadError(describeApiError(error))
      } finally {
        setLoading(false)
        loadedRef.current = true
      }
    } else {
      // 新建：读取本地草稿（包含正文 + 元信息）
      try {
        const raw = localStorage.getItem(STORAGE_KEY(collection, 'new'))
        if (raw) {
          const bundle = JSON.parse(raw) as {
            content?: string
            meta?: Partial<PublishMeta>
          }
          if (bundle.content) {
            setContent(bundle.content)
            // 恢复的草稿即新的「初始内容」，否则清空正文会被误判为无改动，旧草稿永远留在本地
            initialContentRef.current = bundle.content
            setSaveTip('已恢复本地草稿')
            setTimeout(() => setSaveTip(''), 2500)
          }
          if (bundle.meta) setMeta(bundle.meta)
        }
      } catch {
        // 忽略 localStorage / JSON 解析异常
      }
      loadedRef.current = true
    }
  }, [id, collection])

  useEffect(() => {
    void load()
    dirtyRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // 自动保存：内容/元信息变化 1 秒防抖写 localStorage（整包保存，防止刷新丢元信息）
  useEffect(() => {
    // 回填完成前不写入，避免覆盖刚拉回/刚恢复的数据
    if (!loadedRef.current) return
    if (content === initialContentRef.current) return
    dirtyRef.current = true
    const timer = setTimeout(() => {
      try {
        // 只有当内容非空 或 meta 有值时才写入，避免空壳草稿污染
        const hasContent = content.trim().length > 0
        const hasMeta =
          Object.values(meta).some((v) => v && (Array.isArray(v) ? v.length > 0 : String(v).length > 0))
        if (hasContent || hasMeta) {
          const bundle = JSON.stringify({ content, meta })
          localStorage.setItem(storageKey, bundle)
          setSaveTip('已自动保存到本地')
          setTimeout(() => setSaveTip(''), 2000)
        } else {
          // 正文已清空：删除本地草稿，否则刷新后旧内容会再次「复活」
          localStorage.removeItem(storageKey)
          dirtyRef.current = false
        }
      } catch {
        // 忽略 localStorage 异常
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [content, meta, storageKey])

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
        e.returnValue = '您有未保存的内容，确定要离开吗?'
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 存草稿：POST（新建）/ PATCH（更新），status=draft
  // overrides：来自元信息弹窗的字段（首次存草稿时必须先选分类，见下），合并进 meta 再提交
  const saveDraft = useCallback(async (overrides?: Partial<PublishMeta>) => {
    if (!content.trim()) {
      setSaveTip('请输入内容')
      setTimeout(() => setSaveTip(''), 2000)
      return
    }
    const m: Partial<PublishMeta> = { ...meta, ...overrides }
    // 分类字段在数据库里是 NOT NULL（同时决定文章 URL 的「分类名/ID」），
    // 没选过分类的新文档直接提交必然 400，所以这里先弹出元信息弹窗补选一次
    if (!m.categoryIds?.length) {
      setModal('draft')
      setSaveTip('请先选择文章分类（决定文章链接）')
      setTimeout(() => setSaveTip(''), 2500)
      return
    }
    setModal(null)
    setMeta(m)
    // 提交互斥：防止连击 / Ctrl+S 与「存草稿 + 发布」并发，导致新建分支建出两份文档
    if (submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    try {
      // 标题为空时自动命名（新建草稿才生成，编辑保留原标题为空则自动生成一次）
      const titleValue = m.title?.trim() || defaultDraftTitle()
      const payload = buildPayload(collection, {
        title: titleValue,
        description: m.description ?? '',
        cover: m.cover ?? '',
        sticky: m.sticky ?? 0,
        mood: m.mood ?? '',
        date: m.date ?? formatDate(new Date()),
        categoryIds: m.categoryIds ?? [],
        tagIds: m.tagIds ?? [],
        content,
        status: 'draft',
      })
      // 用 ref 取「当前 id」：新建成功后同步可读，避免同周期内二次提交又走新建分支
      const docId = id || createdIdRef.current
      if (docId) {
        await updateDoc(collection, docId, payload)
        setSaveTip('草稿已更新')
      } else {
        const created = await createDoc<{ id: number }>(collection, payload)
        createdIdRef.current = String(created.id)
        setCreatedId(String(created.id))
        setSaveTip('已保存到草稿箱')
      }
      dirtyRef.current = false
      // 清本地：
      // - 更新路径：clearLocal() 已能拿到当前 :{id} key
      // - 新建路径：clearLocal() 闭包里的 storageKey 仍是 :new，
      //   这里先清掉 :new 防止下次进入"新建"误恢复；
      //   真正 :{id} 键此时尚未写入，下次 effect 运行时会用正确的 key
      if (id || currentId) {
        clearLocal()
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY(collection, 'new'))
        } catch {
          // 忽略 localStorage 异常
        }
      }
      setTimeout(() => setSaveTip(''), 2500)
    } catch (error) {
      // 401/403 等认证类错误给专门提示，避免用户误以为内容丢失（本地草稿仍在）
      setSaveTip(`保存失败：${describeApiError(error)}`)
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }, [collection, content, meta, currentId, clearLocal, id])

  // 用 ref 持有 saveDraft，保证 keydown 监听读到最新闭包
  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  // 发布：提交 status=published，成功后跳转对应管理列表
  const publish = async (m: PublishMeta) => {
    // 与存草稿共用同一把互斥锁，避免「发布」与「存草稿/Ctrl+S」并发建出两份文档
    if (submittingRef.current) return
    submittingRef.current = true
    setPublishSaving(true)
    // 先把弹窗里的元信息并回 meta：发布失败时（例如后台校验不过）用户接着「存草稿」
    // 不应该因为 categoryIds 仍为空又被要求重选一次
    setMeta((prev) => ({ ...prev, ...m }))
    try {
      const payload = buildPayload(collection, {
        title: m.title || meta.title || '',
        description: m.description ?? '',
        cover: m.cover ?? '',
        sticky: m.sticky ?? 0,
        mood: m.mood ?? '',
        date: m.date ?? formatDate(new Date()),
        categoryIds: m.categoryIds,
        tagIds: m.tagIds,
        content,
        status: 'published',
      })
      // 用 ref 取「当前 id」：新建成功后同步可读，二次提交走更新而非再建一份
      const docId = id || createdIdRef.current
      if (docId) {
        await updateDoc(collection, docId, payload)
      } else {
        const created = await createDoc<{ id: number }>(collection, payload)
        createdIdRef.current = String(created.id)
      }
      clearLocal()
      dirtyRef.current = false
      setModal(null)
      // 整页跳转到管理列表，保证列表数据刷新（成功即离开，无需释放提交锁）
      window.location.assign(`${adminRoute}/collections/${collection}`)
    } catch (error) {
      submittingRef.current = false
      setPublishSaving(false)
      // 与 saveDraft 保持同一套错误文案映射（401/403 等认证类错误明确提示）
      alert(`发布失败：${describeApiError(error)}`)
    }
  }

  return (
    <div className="compose">
      <PageHeader
        title={title}
        actions={
          <>
            {saveTip && <span className="compose__tip">{saveTip}</span>}
            <button type="button" className="compose__btn" onClick={() => void saveDraft()} disabled={loading}>
              💾 存草稿
            </button>
            <button
              type="button"
              className="compose__btn compose__btn--primary"
              onClick={() => setModal('publish')}
              disabled={loading}
            >
              🚀 发布
            </button>
          </>
        }
      />

      <div className="compose__body">
        {loadError && (
          <div className="compose__error" role="alert">
            <span>加载内容失败：{loadError}</span>
            <button type="button" className="compose__btn" onClick={() => void load()} disabled={loading}>
              重试
            </button>
          </div>
        )}
        <MarkdownEditor value={content} onChange={setContent} label="正文内容（Markdown）" />
      </div>

      {modal && (
        <PublishModal
          collection={collection}
          mode={modal}
          initial={meta}
          saving={modal === 'draft' ? loading : publishSaving}
          onCancel={() => setModal(null)}
          onConfirm={async (m) => {
            // 'draft' 模式只为补元信息（尤其是必填的分类），确认后直接落草稿
            if (modal === 'draft') {
              await saveDraft(m)
            } else {
              await publish(m)
            }
          }}
        />
      )}
    </div>
  )
}

export default ComposeView
