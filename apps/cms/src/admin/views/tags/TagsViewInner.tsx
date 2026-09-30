'use client'

/**
 * 标签管理双栏视图（替换 Payload 默认列表）
 *
 * 版式对齐设计图：左「全部标签」表格（ID/标签名称/关联文章/操作 + 搜索），
 * 右侧常驻「新建标签」面板；点编辑时该面板切换为编辑态回填名称，保存后回到新建态。
 *
 * - 关联文章数 = 文章 + 随笔引用该标签的篇数，加载时并行聚合
 * - 删除被引用的标签不拦截，但确认框警告「将自动从 N 篇内容上移除」
 * - 加载中仅刷新数据区，页头 / 面板骨架常驻
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { createTerm, deleteTag, fetchTagUsage, fetchTerms, updateTag, type TermOption } from '../lib/api'

export const TagsViewInner = () => {
  const [docs, setDocs] = useState<TermOption[]>([])
  const [usage, setUsage] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  // 右侧面板：editingId 为 null 时是新建态
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<TermOption | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tags, counts] = await Promise.all([fetchTerms('tags'), fetchTagUsage()])
      setDocs(tags)
      setUsage(counts)
    } catch {
      setDocs([])
      setUsage({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return docs
    return docs.filter((d) => String(d.name ?? '').toLowerCase().includes(kw))
  }, [docs, keyword])

  const resetPanel = () => {
    setName('')
    setEditingId(null)
    setError('')
  }

  const submit = async () => {
    const v = name.trim()
    if (!v) {
      setError('请填写标签名称')
      return
    }
    if (docs.some((d) => d.id !== editingId && String(d.name) === v)) {
      setError(`已存在同名标签「${v}」`)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editingId != null) await updateTag(editingId, { name: v })
      else await createTerm('tags', v)
      resetPanel()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (d: TermOption) => {
    setEditingId(d.id)
    setName(String(d.name ?? ''))
    setError('')
  }

  const handleDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteTag(confirmDel.id)
      if (editingId === confirmDel.id) resetPanel()
      setConfirmDel(null)
      await load()
    } catch (e) {
      alert((e as Error).message)
      setConfirmDel(null)
    } finally {
      setBusy(false)
    }
  }

  const delCount = confirmDel ? (usage[confirmDel.id] ?? 0) : 0

  return (
    <div className="drafts tag">
      <PageHeader eyebrow="Tags" title="标签管理" />

      <div className="tag__layout">
        {/* 左：全部标签 */}
        <section className="tag__panel">
          <header className="tag__panel-head">
            <h2 className="tag__panel-title">
              全部标签
              <span className="tag__count">{filtered.length}</span>
            </h2>
            <input
              type="search"
              className="trash__search tag__search"
              placeholder="搜索标签名称..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索标签名称"
            />
          </header>

          {loading ? (
            <p className="drafts__empty">加载中…</p>
          ) : docs.length === 0 ? (
            <div className="tag__empty">
              <span className="tag__empty-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.9l7.7 7.7a2 2 0 0 1 0 2.8Z" />
                  <circle cx="7.5" cy="7.5" r="1.5" />
                </svg>
              </span>
              <p>还没有标签，在右侧创建第一个吧</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="drafts__empty">未找到匹配「{keyword.trim()}」的标签</p>
          ) : (
            <table className="tag__table">
              <thead>
                <tr>
                  <th className="tag__col-id">ID</th>
                  <th>标签名称</th>
                  <th className="tag__col-usage">关联文章</th>
                  <th className="tag__col-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td className="tag__col-id">{d.id}</td>
                    <td className="tag__cell-name">{d.name}</td>
                    <td className="tag__col-usage">{usage[d.id] ?? 0}</td>
                    <td className="tag__col-ops">
                      <button type="button" className="drafts__op" onClick={() => startEdit(d)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="drafts__op drafts__op--danger"
                        onClick={() => setConfirmDel(d)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 右：新建 / 编辑面板 */}
        <aside className="tag__side">
          <div className="tag__side-head">
            <span className="tag__side-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.9l7.7 7.7a2 2 0 0 1 0 2.8Z" />
                <circle cx="7.5" cy="7.5" r="1.5" />
              </svg>
            </span>
            <div>
              <h3>{editingId != null ? '编辑标签' : '新建标签'}</h3>
              <p>为文章添加语义化标签，便于检索与归档</p>
            </div>
          </div>
          <label className="tag__label" htmlFor="tag-name-input">
            标签名称
          </label>
          <input
            id="tag-name-input"
            type="text"
            className="tag__input"
            placeholder="# 例如：React、随笔、教程"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void submit()
            }}
          />
          {error && <p className="tag__error">{error}</p>}
          <button type="button" className="tag__submit" disabled={busy} onClick={() => void submit()}>
            {editingId != null ? '保存修改' : '+ 新增标签'}
          </button>
          {editingId != null && (
            <button type="button" className="tag__cancel" onClick={resetPanel} disabled={busy}>
              取消编辑
            </button>
          )}
        </aside>
      </div>

      {confirmDel && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmDel(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              {delCount > 0
                ? `标签「${confirmDel.name}」正被 ${delCount} 篇内容使用，删除后将自动从这些内容上移除。确定删除吗？`
                : `确定删除标签「${confirmDel.name}」吗？`}
            </p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TagsViewInner
