'use client'

/**
 * 友链管理（卡片视图，替换 Payload 默认表格）
 *
 * 版式对齐「图片管理 / 标签管理」：页头 + 工具栏（搜索 + 状态筛选 + 新建）+ 卡片网格，
 * 每张卡片包住一条友链的全部关键信息，审核动作直接在卡片上完成，不用进编辑页。
 *
 * 设计取舍：
 *   - 新建/编辑不跳 Payload 原生编辑页，直接在当前页弹卡片式表单（FriendFormDialog）。
 *     原生页是整页跳转，回来时筛选、搜索、滚动位置全丢；友链字段都是扁平文本，
 *     一枚弹窗足够，保存后就地更新那一张卡片。
 *   - 状态筛选是本页的主线：待审核队列是站长每天要看的东西，所以做成页签并带计数。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Toast, useToast } from '../../components/Toast'
import { describeApiError } from '../lib/api'
import { FriendFormDialog } from './FriendFormDialog'

export interface FriendDoc {
  id: number
  name: string
  url: string
  description?: string | null
  avatar?: string | null
  note?: string | null
  /** 集合里的必填字段；前台不分组，但编辑时要原样带回去，别覆盖用户将来可能录的值 */
  group?: string | null
  sortOrder?: number | null
  status?: string | null
  source?: string | null
  email?: string | null
  message?: string | null
  submitIp?: string | null
  createdAt?: string
  updatedAt?: string
}

export type FriendStatus = 'pending' | 'published' | 'rejected' | 'hidden'

const STATUS_META: Record<FriendStatus, { label: string; tone: 'warn' | 'ok' | 'muted' }> = {
  pending: { label: '待审核', tone: 'warn' },
  published: { label: '已通过', tone: 'ok' },
  rejected: { label: '已拒绝', tone: 'muted' },
  hidden: { label: '已隐藏', tone: 'muted' },
}

/**
 * 筛选页签：只收录「站长得主动处理」的三种状态。
 *
 * 「已拒绝」不进页签 —— 不想要的友链直接删掉更干净，留着 rejected 只会多一个永远空着的
 * 页签。历史数据里若有 rejected（早期接口写的），仍会在「全部」里以灰色徽章出现，
 * 也能通过弹窗改回其他状态，只是不再提供「拒绝」这个动作入口。
 */
const STATUS_TABS: Array<{ key: 'all' | FriendStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'published', label: '已通过' },
  { key: 'hidden', label: '已隐藏' },
]

/** 域名：卡片上比整条 URL 干净 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** 首字兜底（Array.from 避免把 emoji 劈成半个代理对） */
const initialOf = (name: string) => Array.from(String(name ?? '').trim())[0] ?? '?'
const dateOf = (value?: string | null) => (value ? String(value).slice(0, 10) : '')

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as { errors?: Array<{ message?: string }> }
      if (json.errors?.length && json.errors[0]?.message) message = json.errors[0].message
    } catch {
      /* 响应体不是 JSON 时保留状态码 */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

const fetchFriends = () =>
  requestJson<{ docs: FriendDoc[] }>('/api/friends?limit=0&sort=sortOrder&depth=0').then(
    (json) => json.docs ?? [],
  )

/**
 * Payload 的 POST / PATCH 返回的是 `{ doc, message }`，**不是文档本身**。
 *
 * 直接 `{ ...item, ...res }` 会得到 `{ ...item, doc, message }` —— status 仍是旧值，
 * 界面上看起来「点了没反应，刷新一下才对」。这里统一拆包。
 * 返回可能为 undefined（响应结构变了/被中间层改写），调用方要能兜底。
 */
const patchFriend = (id: number, data: Record<string, unknown>) =>
  requestJson<{ doc?: FriendDoc }>(`/api/friends/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then((json) => json.doc)

const removeFriend = (id: number) =>
  requestJson<unknown>(`/api/friends/${id}`, { method: 'DELETE' })

export const FriendsViewInner = () => {
  const [rows, setRows] = useState<FriendDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<'all' | FriendStatus>('all')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState<FriendDoc | null>(null)
  /** null = 弹窗关闭；mode=create 空表单，mode=edit 回填该记录 */
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; doc: FriendDoc } | null>(
    null,
  )

  const { toast, show } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchFriends())
    } catch (e) {
      setRows([])
      show('error', describeApiError(e))
    } finally {
      setLoading(false)
    }
    // show 来自 useToast，引用稳定，不必进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 各状态计数：页签上直接显示，不用点进去才知道有没有待审 */
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const row of rows) {
      const key = String(row.status ?? 'pending')
      map[key] = (map[key] ?? 0) + 1
    }
    return map
  }, [rows])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      if (status !== 'all' && String(row.status ?? 'pending') !== status) return false
      if (!kw) return true
      return (
        String(row.name ?? '').toLowerCase().includes(kw) ||
        String(row.url ?? '').toLowerCase().includes(kw) ||
        String(row.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [rows, status, keyword])

  const setFriendStatus = async (row: FriendDoc, next: FriendStatus) => {
    setBusyId(row.id)
    try {
      const updated = await patchFriend(row.id, { status: next })
      /**
       * 状态是我们明确要改的字段，所以用 next 兜底合并 —— 即使服务端没回文档，
       * 界面上也必须立刻切过去。当前筛选不匹配时（比如在「已隐藏」里点通过），
       * rows 一变 filtered 就重算，这张卡片自然就从列表里消失了，不需要刷新。
       */
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, ...(updated ?? {}), status: next } : item,
        ),
      )
      show('success', `「${row.name}」已${STATUS_META[next].label.replace('已', '')}`)
    } catch (e) {
      show('error', describeApiError(e))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 弹窗保存成功：新建的按 sortOrder 插回有序列表，编辑的就地替换。
   * 都不整表重拉 —— 重拉会让卡片闪一下、滚动位置也可能跳。
   *
   * doc 为 null 表示服务端没回文档（拿不到 id 就没法插入列表），此时退回重拉。
   */
  const handleSaved = (doc: FriendDoc | null, mode: 'create' | 'update') => {
    setDialog(null)
    if (!doc) {
      void load()
      show('success', mode === 'create' ? '友链已添加' : '已保存')
      return
    }
    if (mode === 'create') {
      setRows((prev) =>
        [...prev, doc].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id),
      )
    } else {
      setRows((prev) => prev.map((item) => (item.id === doc.id ? { ...item, ...doc } : item)))
    }
    show('success', mode === 'create' ? '友链已添加' : '已保存')
  }

  const handleDelete = async () => {
    if (!confirmDel) return
    setBusyId(confirmDel.id)
    try {
      await removeFriend(confirmDel.id)
      setRows((prev) => prev.filter((item) => item.id !== confirmDel.id))
      show('success', '已删除')
    } catch (e) {
      show('error', describeApiError(e))
    } finally {
      setBusyId(null)
      setConfirmDel(null)
    }
  }

  return (
    <div className="drafts friends">
      <PageHeader
        title="友链管理"
        actions={
          <button
            type="button"
            className="manage__action friends__new"
            onClick={() => setDialog({ mode: 'create' })}
          >
            + 新建友链
          </button>
        }
      />

      {/* 工具栏：搜索 + 状态页签 */}
      <div className="trash__toolbar">
        <input
          type="search"
          className="trash__search"
          placeholder="搜索站点名称、地址或描述..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索友链"
        />
        <div className="friends__filters" role="tablist" aria-label="按状态筛选">
          {STATUS_TABS.map((tab) => {
            const active = status === tab.key
            const count = counts[tab.key] ?? 0
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`friends__filter${active ? ' friends__filter--active' : ''}`}
                onClick={() => setStatus(tab.key)}
              >
                {tab.label}
                {count > 0 && <span className="friends__filter-count">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* 卡片网格 */}
      {loading ? (
        <p className="drafts__empty">加载中…</p>
      ) : rows.length === 0 ? (
        <div className="friends__empty">
          <span className="friends__empty-icon" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M9.6 14.4l4.8-4.8" />
              <path d="M8.2 11.6l-2 2a3.6 3.6 0 105.1 5.1l2-2" />
              <path d="M15.8 12.4l2-2a3.6 3.6 0 10-5.1-5.1l-2 2" />
            </svg>
          </span>
          <h3>还没有友链</h3>
          <p>访客在评论区留言或发邮件申请后，在这里审核通过就会出现在前台</p>
          <button
            type="button"
            className="manage__action friends__new"
            onClick={() => setDialog({ mode: 'create' })}
          >
            新建第一条
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="drafts__empty">
          {keyword.trim() ? `未找到匹配「${keyword.trim()}」的友链` : '这个状态下还没有友链'}
        </p>
      ) : (
        <div className="friends__grid">
          {filtered.map((row) => {
            const key = (String(row.status ?? 'pending') as FriendStatus) ?? 'pending'
            const meta = STATUS_META[key] ?? STATUS_META.pending
            const busy = busyId === row.id
            return (
              <article key={row.id} className="friends__card" data-status={key}>
                <header className="friends__head">
                  <span className="friends__avatar">
                    <span className="friends__initial" aria-hidden="true">
                      {initialOf(row.name)}
                    </span>
                    {row.avatar ? (
                      // 图挂了就摘掉，露出下面的首字
                      <img
                        src={row.avatar}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).remove()
                        }}
                      />
                    ) : null}
                  </span>
                  <div className="friends__title">
                    <h3 className="friends__name" title={row.name}>
                      {row.name}
                    </h3>
                    <a
                      className="friends__host"
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.url}
                    >
                      {hostOf(row.url)}
                    </a>
                  </div>
                  <span className={`friends__badge friends__badge--${meta.tone}`}>{meta.label}</span>
                </header>

                <p className="friends__desc">
                  {row.description?.trim() || <span className="friends__desc-empty">（没有填写描述）</span>}
                </p>

                <footer className="friends__foot">
                  <span className="friends__meta">
                    {row.source === 'apply' ? '访客申请' : '手动添加'} · {dateOf(row.createdAt)}
                  </span>
                  <div className="friends__ops">
                    {/* 待审核只有一个动作：通过。不想要的直接删除，不留「拒绝」这个终点状态 */}
                    {key === 'pending' && (
                      <button
                        type="button"
                        className="drafts__op"
                        disabled={busy}
                        onClick={() => void setFriendStatus(row, 'published')}
                      >
                        通过
                      </button>
                    )}
                    {key === 'published' && (
                      <button
                        type="button"
                        className="drafts__op"
                        disabled={busy}
                        onClick={() => void setFriendStatus(row, 'hidden')}
                      >
                        隐藏
                      </button>
                    )}
                    {(key === 'rejected' || key === 'hidden') && (
                      <button
                        type="button"
                        className="drafts__op"
                        disabled={busy}
                        onClick={() => void setFriendStatus(row, 'published')}
                      >
                        通过
                      </button>
                    )}
                    <button
                      type="button"
                      className="drafts__op"
                      disabled={busy}
                      onClick={() => setDialog({ mode: 'edit', doc: row })}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      disabled={busy}
                      onClick={() => setConfirmDel(row)}
                    >
                      删除
                    </button>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      )}

      {/* 新建 / 编辑：页面内弹窗，不跳原生编辑页 */}
      <FriendFormDialog
        open={dialog !== null}
        initial={dialog?.mode === 'edit' ? dialog.doc : null}
        onClose={() => setDialog(null)}
        onSaved={handleSaved}
      />

      {/* 删除确认 */}
      {confirmDel && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmDel(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              确定删除友链「{confirmDel.name}」吗？删除后前台会立即消失，且无法恢复。
            </p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={busyId === confirmDel.id}
                onClick={() => void handleDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}

export default FriendsViewInner
