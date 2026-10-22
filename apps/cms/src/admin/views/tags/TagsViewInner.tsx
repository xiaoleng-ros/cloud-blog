'use client'

/**
 * 标签管理双栏视图（替换 Payload 默认列表）
 *
 * 版式对齐设计图：左「全部标签」表格（勾选/ID/标签名称/关联文章/操作 + 搜索），
 * 右侧常驻「新建标签」面板；点编辑时该面板切换为编辑态回填名称，保存后回到新建态。
 *
 * - 关联文章数 = 文章 + 随笔引用该标签的篇数，加载时并行聚合
 * - 删除被引用的标签不拦截，但确认框警告「将自动从 N 篇内容上移除」
 * - 多选：勾选列 + 批量删除（串行 + 进度显示）
 * - 加载中仅刷新数据区，页头 / 面板骨架常驻
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Toast, useToast } from '../../components/Toast'
import { createTerm, deleteTag, describeApiError, fetchTagUsage, fetchTerms, updateTag, type TermOption } from '../lib/api'

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
  const [createProgress, setCreateProgress] = useState<{ current: number; total: number } | null>(null)
  const [confirmDel, setConfirmDel] = useState<TermOption | null>(null)

  // ---- 多选 ----
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<number[] | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const { toast, show } = useToast()

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

  /**
   * 拆分一次输入的多个标签名。
   * 以顿号（、）为主，兼容全角/半角逗号与换行（粘贴列表时常见）；空项与重复项去掉，保留输入顺序。
   */
  const splitNames = (raw: string) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const piece of raw.split(/[、，,\n\r]/)) {
      const v = piece.trim()
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  }

  const submit = async () => {
    const raw = name.trim()
    if (!raw) {
      setError('请填写标签名称')
      return
    }

    // 编辑态只改一个名称，不拆分
    if (editingId != null) {
      if (docs.some((d) => d.id !== editingId && String(d.name) === raw)) {
        setError(`已存在同名标签「${raw}」`)
        return
      }
      setBusy(true)
      setError('')
      try {
        await updateTag(editingId, { name: raw })
        resetPanel()
        await load()
        show('success', '已保存')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
      return
    }

    // 新建态：一次可填多个，用顿号隔开；已存在的跳过，不打断其余创建
    const names = splitNames(raw)
    const existing = new Set(docs.map((d) => String(d.name)))
    const dupes = names.filter((v) => existing.has(v))
    const fresh = names.filter((v) => !existing.has(v))
    if (!fresh.length) {
      setError(
        dupes.length > 1
          ? `这些标签都已存在：${dupes.map((v) => `「${v}」`).join('、')}`
          : `已存在同名标签「${dupes[0]}」`,
      )
      return
    }

    setBusy(true)
    setError('')
    const failed: string[] = []
    try {
      for (let i = 0; i < fresh.length; i++) {
        setCreateProgress({ current: i + 1, total: fresh.length })
        try {
          await createTerm('tags', fresh[i])
        } catch {
          failed.push(fresh[i])
        }
      }
      const ok = fresh.length - failed.length
      resetPanel()
      await load()

      const notes: string[] = []
      if (ok > 0) notes.push(ok > 1 ? `已创建 ${ok} 个标签` : '已创建')
      if (dupes.length) notes.push(`${dupes.length} 个已存在，已跳过`)
      if (failed.length) notes.push(`${failed.length} 个创建失败`)
      show(failed.length ? 'error' : 'success', notes.join('，'))

      // 失败的留回输入框，方便直接重试
      if (failed.length) setName(failed.join('、'))
    } finally {
      setCreateProgress(null)
      setBusy(false)
    }
  }

  const startEdit = (d: TermOption) => {
    setEditingId(d.id)
    setName(String(d.name ?? ''))
    setError('')
  }

  // ---- 多选控制 ----

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id))
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allFilteredSelected) return new Set()
      return new Set(filtered.map((d) => d.id))
    })
  }

  // ---- 单条删除 ----

  const handleDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteTag(confirmDel.id)
      if (editingId === confirmDel.id) resetPanel()
      // 清除选中状态
      setSelected((prev) => {
        if (!prev.has(confirmDel.id)) return prev
        const next = new Set(prev)
        next.delete(confirmDel.id)
        return next
      })
      setConfirmDel(null)
      await load()
      show('success', '已删除')
    } catch (e) {
      show('error', describeApiError(e))
      setConfirmDel(null)
    } finally {
      setBusy(false)
    }
  }

  // ---- 批量删除 ----

  const confirmBatchDeleteAction = async () => {
    if (!confirmBatchDelete || confirmBatchDelete.length === 0) return
    setBatchBusy(true)

    const ids = confirmBatchDelete
    let ok = 0
    let fail = 0

    for (let i = 0; i < ids.length; i++) {
      setBatchProgress({ current: i + 1, total: ids.length })
      try {
        await deleteTag(ids[i])
        ok++
      } catch {
        fail++
      }
    }

    setBatchProgress(null)
    setBatchBusy(false)
    setConfirmBatchDelete(null)
    setSelected(new Set())
    await load()

    // 清除正在编辑的被删除标签
    if (editingId != null && ids.includes(editingId)) resetPanel()

    if (fail === 0) {
      show('success', ok > 1 ? `已删除 ${ok} 个标签` : '已删除')
    } else if (ok > 0) {
      show('error', `删除 ${ok} 个，失败 ${fail} 个（部分可能已删除，请刷新确认）`)
    } else {
      show('error', '删除失败：后台响应过慢。请刷新列表确认真实状态')
    }
  }

  const delCount = confirmDel ? (usage[confirmDel.id] ?? 0) : 0

  // 批量删除的关联文章总数
  const batchDelCount = useMemo(() => {
    if (!confirmBatchDelete) return 0
    return confirmBatchDelete.reduce((sum, id) => sum + (usage[id] ?? 0), 0)
  }, [confirmBatchDelete, usage])

  return (
    <div className="drafts tag">
      <PageHeader title="标签管理" />

      <div className="tag__layout">
        {/* 左：全部标签 */}
        <section className="tag__panel">
          <header className="tag__panel-head">
            <h2 className="tag__panel-title">
              全部标签
              <span className="tag__count">{filtered.length}</span>
            </h2>
            <div className="tag__panel-head-actions">
              <input
                type="search"
                className="trash__search tag__search"
                placeholder="搜索标签名称..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索标签名称"
              />
              <button
                type="button"
                className="manage__action manage__action--danger"
                disabled={selected.size === 0 || batchBusy}
                onClick={() => setConfirmBatchDelete([...selected])}
              >
                批量删除{selected.size ? `（${selected.size}）` : ''}
              </button>
            </div>
          </header>

          {/* 全选栏 */}
          {!loading && filtered.length > 0 && (
            <div className="tag__select-bar">
              <label className="tag__select-all">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  aria-label="全选可见标签"
                />
                <span>全选（{filtered.length}）</span>
              </label>
            </div>
          )}

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
                  <th className="tag__col-check">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="全选本页标签"
                    />
                  </th>
                  <th className="tag__col-id">ID</th>
                  <th>标签名称</th>
                  <th className="tag__col-usage">关联文章</th>
                  <th className="tag__col-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td className="tag__col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggleRow(d.id)}
                        aria-label={`选择 ${d.name}`}
                      />
                    </td>
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
            placeholder={editingId != null ? '# 标签名称' : '# 例如：React、随笔、教程（顿号可分隔多个）'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void submit()
            }}
          />
          {editingId == null && (
            <p className="tag__hint">一次可填多个，用顿号（、）隔开，提交后逐个创建</p>
          )}
          {error && <p className="tag__error">{error}</p>}
          <button type="button" className="tag__submit" disabled={busy} onClick={() => void submit()}>
            {createProgress
              ? `创建中 ${createProgress.current} / ${createProgress.total}…`
              : editingId != null
                ? '保存修改'
                : '+ 新增标签'}
          </button>
          {editingId != null && (
            <button type="button" className="tag__cancel" onClick={resetPanel} disabled={busy}>
              取消编辑
            </button>
          )}
        </aside>
      </div>

      {/* 单条删除确认 */}
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

      {/* 批量删除确认（带进度显示） */}
      {confirmBatchDelete && (
        <div className="drafts__confirm-mask" onClick={() => !batchBusy && setConfirmBatchDelete(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认批量删除</h3>
            <p>
              确定删除选中的 {confirmBatchDelete.length} 个标签吗？
              {batchDelCount > 0
                ? `这些标签正被 ${batchDelCount} 篇内容使用，删除后将自动从内容上移除。`
                : ''}
            </p>
            {batchProgress && (
              <p className="manage__delete-progress">
                删除中 {batchProgress.current} / {batchProgress.total}…
              </p>
            )}
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" disabled={batchBusy} onClick={() => setConfirmBatchDelete(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={batchBusy}
                onClick={() => void confirmBatchDeleteAction()}
              >
                {batchProgress ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}

export default TagsViewInner
