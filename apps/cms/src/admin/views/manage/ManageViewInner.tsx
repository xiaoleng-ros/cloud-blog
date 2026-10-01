'use client'

/**
 * 文章 / 随笔「管理」列表（client 组件，替换 Payload 默认列表视图）
 *
 * 版式对齐回收站 / 草稿箱：PageHeader + 工具栏 + 表格 + 分页。
 * 相比默认列表，这里补齐旧版后台的能力：
 *   1. 工具栏：标题搜索 / 分类下拉 / 标签下拉 / 创建时间范围 / 重置
 *   2. 右上角：导出（当前筛选全量或选中项，下载 JSON）、导入（同格式 JSON 批量新建）、批量删除
 *   3. 表格：勾选列 + 封面(文章)/日期(随笔) + 标题 + 摘要 + 分类 + 标签 + 浏览 + 评论 + 操作
 *
 * 约定：
 * - 「删除」= 软删除移入回收站（与单条删除、草稿箱一致），可在回收站恢复
 * - 浏览 / 评论暂无数据源，占位显示「—」
 * - 加载中仅刷新数据区，页头 / 工具栏 / 表头骨架常驻
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useConfig } from '@payloadcms/ui'
import { PageHeader } from '../../components/PageHeader'
import { clip, extractNames, fmt, tagPill } from '../lib/format'
import {
  ApiError,
  createDoc,
  createTerm,
  fetchTerms,
  listDocs,
  trashDoc,
  type AdminNote,
  type AdminPost,
  type TermOption,
} from '../lib/api'

type Collection = 'posts' | 'notes'

/** 归一化后的表格行 */
interface ManageRow {
  id: number
  title: string
  excerpt: string
  categoryNames: string[]
  tagNames: string[]
  cover?: string | null
  date?: string | null
  status?: string | null
  createdAt?: string
}

/** 每个集合的差异化配置 */
const COLLECTION_META: Record<
  Collection,
  {
    eyebrow: string
    title: string
    desc: string
    writePath: string
    writeLabel: string
    /** 日期范围过滤与「日期」列使用的字段：文章按 createdAt，随笔按 date */
    dateField: 'createdAt' | 'date'
    hasCover: boolean
    emptyText: string
  }
> = {
  posts: {
    eyebrow: 'Posts',
    title: '文章管理',
    desc: '全部文章（含草稿），可筛选、导出、导入与批量管理。',
    writePath: 'write-post',
    writeLabel: '写文章',
    dateField: 'createdAt',
    hasCover: true,
    emptyText: '暂无文章，点击右上角「写文章」开始创作',
  },
  notes: {
    eyebrow: 'Notes',
    title: '随笔管理',
    desc: '全部随笔（含草稿），可筛选、导出、导入与批量管理。',
    writePath: 'write-note',
    writeLabel: '写随笔',
    dateField: 'date',
    hasCover: false,
    emptyText: '暂无随笔，点击右上角「写随笔」开始创作',
  },
}

const PAGE_SIZE = 10

/**
 * 把后端错误映射成给用户看的文案
 * - Payload 的 4xx 业务错误（含 APIError 抛出的中文提示，如分类被引用、无权限）保留原文展示
 * - 5xx 或非 Payload（网络）错误统一为通用文案，避免把 String(err) 原样弹给用户
 */
const friendlyError = (error: unknown, fallback = '操作失败，请稍后重试'): string => {
  if (error instanceof ApiError && error.status < 500) return error.message
  return fallback
}

export const ManageViewInner = ({ collection }: { collection: Collection }) => {
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const meta = COLLECTION_META[collection]

  const [titleInput, setTitleInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [rows, setRows] = useState<ManageRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [cats, setCats] = useState<TermOption[]>([])
  const [tags, setTags] = useState<TermOption[]>([])

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)

  const [exportOpen, setExportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 列表请求序号：快速切换筛选时，只采用最新一次请求的响应，丢弃过期响应（防竞态覆盖）
  const reqSeq = useRef(0)

  // 输入停顿 400ms 后才发起查询，避免每敲一个字打一次 API
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(titleInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [titleInput])

  // 分类 / 标签下拉选项：进入页面拉一次
  useEffect(() => {
    void fetchTerms('categories').then(setCats).catch(() => setCats([]))
    void fetchTerms('tags').then(setTags).catch(() => setTags([]))
  }, [])

  /** 组装当前筛选 where（供列表与导出复用） */
  const buildWhere = useCallback((): Record<string, unknown> => {
    const and: Record<string, unknown>[] = []
    if (keyword) and.push({ title: { like: keyword } })
    if (catFilter) and.push({ categories: { equals: Number(catFilter) } })
    if (tagFilter) and.push({ tags: { in: [Number(tagFilter)] } })
    if (from) and.push({ [meta.dateField]: { greater_than_equal: from } })
    if (to) and.push({ [meta.dateField]: { less_than_equal: to } })
    return and.length ? { and } : {}
  }, [keyword, catFilter, tagFilter, from, to, meta.dateField])

  const load = useCallback(async () => {
    const myReq = ++reqSeq.current
    setLoading(true)
    try {
      const res = await listDocs<AdminPost | AdminNote>(collection, buildWhere(), page, PAGE_SIZE, '-createdAt')
      // 已有更新的请求发出：丢弃这次的响应，避免旧筛选结果覆盖新结果
      if (myReq !== reqSeq.current) return
      setTotal(res.totalDocs)
      setRows(
        res.docs.map((d) => {
          const post = d as AdminPost
          const note = d as AdminNote
          return {
            id: d.id,
            title: (d.title ?? '').trim() || '（无标题）',
            excerpt:
              collection === 'posts'
                ? (post.description ?? '').trim() || clip(post.content) || '—'
                : (note.mood ?? '').trim() || clip(note.content) || '—',
            categoryNames: extractNames(d.categories),
            tagNames: extractNames(d.tags),
            cover: post.cover,
            date: note.date,
            status: d.status,
            createdAt: d.createdAt,
          }
        }),
      )
      setSelected(new Set())
    } catch {
      if (myReq !== reqSeq.current) return
      setRows([])
      setTotal(0)
    } finally {
      // 只有最新请求才收敛 loading，过期请求不再改动 loading 态
      if (myReq === reqSeq.current) setLoading(false)
    }
  }, [collection, buildWhere, page])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const resetFilters = () => {
    setTitleInput('')
    setKeyword('')
    setCatFilter('')
    setTagFilter('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allOnPageSelected) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  /** 确认删除：软删除移入回收站（各条独立，并行提交消除 N+1 串行等待） */
  const confirmDelete = async () => {
    if (!confirmIds || confirmIds.length === 0) return
    setBusy(true)
    try {
      await Promise.all(confirmIds.map((id) => trashDoc(collection, id)))
      setConfirmIds(null)
      await load()
    } catch (error) {
      alert(`删除失败：${friendlyError(error)}`)
      setConfirmIds(null)
    } finally {
      setBusy(false)
    }
  }

  /** 把一篇完整文档映射为导出结构（关系字段落成名称，便于导入匹配） */
  const docToExport = (d: AdminPost | AdminNote) => {
    const category = extractNames(d.categories)[0] ?? null
    const tagNames = extractNames(d.tags)
    if (collection === 'posts') {
      const p = d as AdminPost
      return {
        title: p.title ?? '',
        description: p.description ?? '',
        cover: p.cover ?? '',
        category,
        tags: tagNames,
        keywords: p.keywords ?? '',
        ai: p.ai ?? '',
        sticky: p.sticky ?? 0,
        status: p.status ?? 'draft',
        content: p.content ?? '',
      }
    }
    const n = d as AdminNote
    return {
      date: n.date ?? '',
      title: n.title ?? '',
      mood: n.mood ?? '',
      category,
      tags: tagNames,
      status: n.status ?? 'draft',
      content: n.content ?? '',
    }
  }

  const downloadJson = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 导出全部：按当前筛选逐页拉全量 */
  const exportAll = async () => {
    setExportOpen(false)
    setBusy(true)
    try {
      const where = buildWhere()
      const first = await listDocs<AdminPost | AdminNote>(collection, where, 1, 100, '-createdAt')
      const docs = [...first.docs]
      const pages = Math.max(1, first.totalPages)
      for (let p = 2; p <= pages; p++) {
        const next = await listDocs<AdminPost | AdminNote>(collection, where, p, 100, '-createdAt')
        docs.push(...next.docs)
      }
      downloadJson(`${collection}-${fmt(new Date().toISOString())}.json`, docs.map(docToExport))
    } catch (error) {
      alert(`导出失败：${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 导出选中：仅当前已勾选的行（从服务端按 id 精确取，避免只导出当前页缓存字段） */
  const exportSelected = async () => {
    setExportOpen(false)
    if (selected.size === 0) return
    setBusy(true)
    try {
      const ids = [...selected]
      const res = await listDocs<AdminPost | AdminNote>(
        collection,
        { id: { in: ids } },
        1,
        Math.max(ids.length, 1),
        '-createdAt',
      )
      downloadJson(`${collection}-selected-${fmt(new Date().toISOString())}.json`, res.docs.map(docToExport))
    } catch (error) {
      alert(`导出失败：${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 导入：解析 JSON 批量新建，分类按名匹配（缺失跳过），标签缺失自动补建 */
  const handleImportFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('文件内容必须是数组（导出的 JSON 格式）')

      const catMap = new Map(cats.map((c) => [c.name, c.id]))
      const tagMap = new Map(tags.map((t) => [t.name, t.id]))

      let ok = 0
      const skipped: string[] = []

      for (const item of parsed as Array<Record<string, unknown>>) {
        const catName = (item.category as string | null) ?? null
        if (!catName || !catMap.has(catName)) {
          skipped.push(String(item.title || item.date || '（无标题）'))
          continue
        }
        const catId = catMap.get(catName) as number

        const tagNames = Array.isArray(item.tags) ? (item.tags as string[]) : []
        const tagIds: number[] = []
        for (const name of tagNames) {
          if (tagMap.has(name)) {
            tagIds.push(tagMap.get(name) as number)
          } else {
            const created = await createTerm('tags', name)
            tagMap.set(name, created.id)
            tagIds.push(created.id)
          }
        }

        const payload: Record<string, unknown> = {
          categories: catId,
          tags: tagIds,
          status: item.status === 'published' ? 'published' : 'draft',
          content: item.content ?? '',
        }
        if (collection === 'posts') {
          if (!item.title) {
            skipped.push('（缺标题）')
            continue
          }
          Object.assign(payload, {
            title: item.title,
            description: item.description ?? '',
            cover: item.cover ?? '',
            keywords: item.keywords ?? '',
            ai: item.ai ?? '',
            sticky: item.sticky ?? 0,
          })
        } else {
          if (!item.date) {
            skipped.push('（缺日期）')
            continue
          }
          Object.assign(payload, {
            date: item.date,
            title: item.title ?? '',
            mood: item.mood ?? '',
          })
        }
        await createDoc(collection, payload)
        ok++
      }

      // 导入可能新建了标签，刷新标签下拉
      void fetchTerms('tags').then(setTags).catch(() => undefined)
      await load()
      alert(
        `导入完成：成功 ${ok} 条` +
          (skipped.length ? `，跳过 ${skipped.length} 条（分类缺失或必填字段为空）` : ''),
      )
    } catch (error) {
      alert(`导入失败：${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const colCount = 9 // 勾选 + 封面/日期 + 标题 + 摘要 + 分类 + 标签 + 浏览 + 评论 + 操作

  return (
    <div className="drafts manage">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={meta.title}
        desc={meta.desc}
        actions={
          <Link href={`${adminRoute}/${meta.writePath}`} prefetch={false} className="manage__create">
            + {meta.writeLabel}
          </Link>
        }
      />

      {/* 工具栏 */}
      <div className="trash__toolbar manage__toolbar">
        <input
          type="search"
          className="trash__search"
          placeholder="搜索标题..."
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          aria-label="搜索标题"
        />
        <select
          className="manage__select"
          value={catFilter}
          aria-label="按分类筛选"
          onChange={(e) => {
            setCatFilter(e.target.value)
            setPage(1)
          }}
        >
          <option value="">分类</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="manage__select"
          value={tagFilter}
          aria-label="按标签筛选"
          onChange={(e) => {
            setTagFilter(e.target.value)
            setPage(1)
          }}
        >
          <option value="">标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="trash__daterange">
          <input
            type="date"
            className="trash__date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            aria-label="开始日期"
          />
          <span className="trash__date-sep" aria-hidden="true">→</span>
          <input
            type="date"
            className="trash__date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            aria-label="结束日期"
          />
        </div>
        <button type="button" className="manage__reset" onClick={resetFilters} aria-label="重置筛选" title="重置">
          ↺
        </button>

        <div className="manage__actions">
          <div className="manage__export">
            <button
              type="button"
              className="manage__action"
              disabled={busy}
              onClick={() => setExportOpen((v) => !v)}
            >
              导出 ▾
            </button>
            {exportOpen && (
              <div className="manage__export-menu">
                <button type="button" onClick={() => void exportAll()}>
                  导出全部（当前筛选）
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => void exportSelected()}
                >
                  导出选中（{selected.size}）
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="manage__action"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            导入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="manage__action manage__action--danger"
            disabled={busy || selected.size === 0}
            onClick={() => setConfirmIds([...selected])}
          >
            删除{selected.size ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      <div className="drafts__list">
        <table className="drafts__table">
          <thead>
            <tr>
              <th className="manage__check-col">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  aria-label="全选本页"
                />
              </th>
              <th>{meta.hasCover ? '封面' : '日期'}</th>
              <th>标题</th>
              <th>摘要</th>
              <th>分类</th>
              <th>标签</th>
              <th>浏览</th>
              <th>评论</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount}>
                  <p className="drafts__empty">加载中…</p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <p className="manage__empty">{meta.emptyText}</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="manage__check-col">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`选择 ${row.title}`}
                    />
                  </td>
                  <td>
                    {meta.hasCover ? (
                      row.cover ? (
                        <img className="manage__cover" src={row.cover} alt="" loading="lazy" />
                      ) : (
                        <span className="drafts__muted">—</span>
                      )
                    ) : (
                      <span className="drafts__cell-date">{fmt(row.date ?? row.createdAt)}</span>
                    )}
                  </td>
                  <td className="drafts__cell-title">
                    {row.title}
                    {row.status === 'draft' && <i className="manage__pill manage__pill--draft">草稿</i>}
                  </td>
                  <td className="drafts__cell-desc">{row.excerpt}</td>
                  <td>{tagPill(row.categoryNames)}</td>
                  <td>{tagPill(row.tagNames)}</td>
                  <td className="drafts__muted">—</td>
                  <td className="drafts__muted">—</td>
                  <td className="drafts__cell-ops">
                    <Link
                      href={`${adminRoute}/${meta.writePath}?id=${row.id}`}
                      prefetch={false}
                      className="drafts__op"
                    >
                      编辑
                    </Link>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      onClick={() => setConfirmIds([row.id])}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="drafts__pager">
          <button type="button" className="drafts__op" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span className="drafts__pager-info">
            {page} / {pageCount}（共 {total} 条）
          </span>
          <button
            type="button"
            className="drafts__op"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {confirmIds && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmIds(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              {confirmIds.length > 1
                ? `确定将选中的 ${confirmIds.length} 条移入回收站吗？`
                : '确定将这条内容移入回收站吗？'}
            </p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setConfirmIds(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                移入回收站
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManageViewInner
