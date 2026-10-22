'use client'

/**
 * 图片管理内容（client 组件，由 MediaListView 包装渲染）
 *
 * 功能：
 * 1. 网格缩略图展示（响应式，每张 ~200px）
 * 2. 上传：单张上传 + 批量上传（串行提交，避免压垮后端）
 * 3. 标题模糊搜索
 * 4. 多选：勾选列 + 批量删除（串行 + 进度显示）
 * 5. 图片预览（点击卡片放大查看）
 * 6. 编辑 alt 文本（SEO 用）
 * 7. 分页（每页 20 张）
 *
 * 版式对齐其他管理页：PageHeader + 工具栏 + 内容区 + 分页。
 * 加载中仅刷新数据区，页头 / 工具栏骨架常驻。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Toast, useToast } from '../../components/Toast'
import { fmt } from '../lib/format'
import {
  deleteMedia,
  deleteMediaBatch,
  describeApiError,
  listMedia,
  updateMedia,
  type MediaDoc,
} from '../lib/api'
import { MAX_SOURCE_IMAGE_BYTES, uploadMedia } from '../../../lib/media-upload'

const PAGE_SIZE = 20

/** 文件大小格式化 */
const fmtSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 图片行归一化 */
interface MediaRow {
  id: number
  filename: string
  url: string
  filesize: number
  width?: number
  height?: number
  alt?: string
  createdAt: string
}

export const MediaViewInner = () => {
  const [rows, setRows] = useState<MediaRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [keyword, setKeyword] = useState('')

  // ---- 多选 ----
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<number[] | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  // ---- 上传 ----
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const singleFileRef = useRef<HTMLInputElement>(null)
  const batchFileRef = useRef<HTMLInputElement>(null)

  // ---- 预览 / 编辑 ----
  const [preview, setPreview] = useState<MediaRow | null>(null)
  const [editing, setEditing] = useState<MediaRow | null>(null)
  const [editAlt, setEditAlt] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<MediaRow | null>(null)
  const [busy, setBusy] = useState(false)

  const { toast, show } = useToast()

  // 输入停顿 400ms 后才发起查询
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(titleInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [titleInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listMedia(page, PAGE_SIZE, '-createdAt', keyword || undefined)
      setTotal(res.totalDocs)
      setRows(
        res.docs.map((d) => ({
          id: d.id,
          filename: d.filename ?? '（未命名）',
          url: d.url ?? '',
          filesize: d.filesize ?? 0,
          width: d.width ?? undefined,
          height: d.height ?? undefined,
          alt: d.alt ?? '',
          createdAt: d.createdAt,
        })),
      )
      setSelected(new Set())
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, keyword])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  // ---- 多选控制 ----

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

  // ---- 上传 ----

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return

    // 前端预检：只拦原图就大到不合理的（40MB+），10MB 的相机原图由 uploadMedia 压完再传
    const valid = files.filter((f) => f.size <= MAX_SOURCE_IMAGE_BYTES)
    const rejected = files.length - valid.length
    if (rejected > 0) {
      show(
        'error',
        `${rejected} 个文件超过 ${(MAX_SOURCE_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB 上限，已跳过`,
      )
    }
    if (valid.length === 0) return

    setUploading(true)
    let ok = 0
    let fail = 0

    for (let i = 0; i < valid.length; i++) {
      setUploadProgress({ current: i + 1, total: valid.length })
      try {
        await uploadMedia(valid[i])
        ok++
      } catch {
        fail++
      }
    }

    setUploadProgress(null)
    setUploading(false)
    await load()

    if (fail === 0) {
      show('success', ok > 1 ? `已上传 ${ok} 张图片` : '已上传')
    } else if (ok > 0) {
      show('error', `上传 ${ok} 张，失败 ${fail} 张（部分可能已成功，请刷新确认）`)
    } else {
      show('error', '上传失败：后台响应过慢。请刷新列表确认真实状态')
    }
  }

  // ---- 单条删除 ----

  const handleDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteMedia(confirmDel.id)
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

    const result = await deleteMediaBatch(confirmBatchDelete, (current, total) => {
      setBatchProgress({ current, total })
    })

    setBatchProgress(null)
    setBatchBusy(false)
    setConfirmBatchDelete(null)
    setSelected(new Set())
    await load()

    if (result.fail === 0) {
      show('success', result.ok > 1 ? `已删除 ${result.ok} 张图片` : '已删除')
    } else if (result.ok > 0) {
      show('error', `删除 ${result.ok} 张，失败 ${result.fail} 张（部分可能已删除，请刷新确认）`)
    } else {
      show('error', '删除失败：后台响应过慢。请刷新列表确认真实状态')
    }
  }

  // ---- 编辑 alt ----

  const handleSaveAlt = async () => {
    if (!editing) return
    setEditBusy(true)
    try {
      await updateMedia(editing.id, { alt: editAlt.trim() || null })
      setEditing(null)
      await load()
      show('success', '已保存')
    } catch (e) {
      show('error', describeApiError(e))
    } finally {
      setEditBusy(false)
    }
  }

  const openEdit = (row: MediaRow) => {
    setEditing(row)
    setEditAlt(row.alt ?? '')
  }

  return (
    <div className="drafts media">
      <PageHeader
        title="图片管理"
        actions={
          <div className="manage__actions">
            <button
              type="button"
              className="manage__action"
              disabled={uploading}
              onClick={() => singleFileRef.current?.click()}
            >
              上传图片
            </button>
            <button
              type="button"
              className="manage__action"
              disabled={uploading}
              onClick={() => batchFileRef.current?.click()}
            >
              批量上传
            </button>
            <input
              ref={singleFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleUploadFiles([file])
                e.target.value = ''
              }}
            />
            <input
              ref={batchFileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files
                if (files?.length) void handleUploadFiles(Array.from(files))
                e.target.value = ''
              }}
            />
          </div>
        }
      />

      {/* 工具栏：搜索 + 批量删除 */}
      <div className="trash__toolbar">
        <input
          type="search"
          className="trash__search"
          placeholder="搜索文件名..."
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          aria-label="搜索文件名"
        />
        <div className="manage__actions">
          <button
            type="button"
            className="manage__action manage__action--danger"
            disabled={selected.size === 0 || batchBusy}
            onClick={() => setConfirmBatchDelete([...selected])}
          >
            批量删除{selected.size ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      {/* 全选栏 */}
      {!loading && rows.length > 0 && (
        <div className="media__select-bar">
          <label className="media__select-all">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleSelectAll}
              aria-label="全选本页图片"
            />
            <span>全选（{rows.length}）</span>
          </label>
          {selected.size > 0 && (
            <span className="media__selected-count">已选 {selected.size} 张</span>
          )}
        </div>
      )}

      {/* 网格内容区 */}
      <div className="media__grid-wrap">
        {loading ? (
          <p className="drafts__empty">加载中…</p>
        ) : rows.length === 0 ? (
          <div className="media__empty">
            <span className="media__empty-icon" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </span>
            <h3>还没有图片</h3>
            <p>上传图片后可用于文章封面、正文插图等场景</p>
            <button
              type="button"
              className="manage__action"
              disabled={uploading}
              onClick={() => singleFileRef.current?.click()}
            >
              上传图片
            </button>
          </div>
        ) : (
          <div className="media__grid">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`media__card${selected.has(row.id) ? ' media__card--selected' : ''}`}
              >
                {/* 缩略图 */}
                <div className="media__thumb">
                  <img
                    src={row.url}
                    alt={row.alt || row.filename}
                    loading="lazy"
                    onClick={() => setPreview(row)}
                  />
                  {/* 勾选框 */}
                  <input
                    type="checkbox"
                    className="media__card-check"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`选择 ${row.filename}`}
                  />
                  {/* alt 标记 */}
                  {row.alt && (
                    <span className="media__alt-badge" title="已设置替代文本">
                      A
                    </span>
                  )}
                </div>
                {/* 信息区 */}
                <div className="media__info">
                  <p className="media__filename" title={row.filename}>
                    {row.filename}
                  </p>
                  <p className="media__meta">
                    {fmtSize(row.filesize)}
                    {row.width && row.height ? ` · ${row.width}×${row.height}` : ''}
                  </p>
                  <div className="media__actions">
                    <button type="button" className="drafts__op" onClick={() => setPreview(row)}>
                      预览
                    </button>
                    <button type="button" className="drafts__op" onClick={() => openEdit(row)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      onClick={() => setConfirmDel(row)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 上传进度 */}
      {uploadProgress && (
        <div className="media__progress-bar">
          <span>
            上传中 {uploadProgress.current} / {uploadProgress.total}…
          </span>
          <div className="media__progress-track">
            <div
              className="media__progress-fill"
              style={{
                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 分页 */}
      {total > PAGE_SIZE && (
        <div className="drafts__pager">
          <button type="button" className="drafts__op" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span className="drafts__pager-info">
            {page} / {pageCount}（共 {total} 张）
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

      {/* 图片预览 */}
      {preview && (
        <div className="media__preview-mask" onClick={() => setPreview(null)}>
          <div className="media__preview" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="media__preview-close"
              onClick={() => setPreview(null)}
              aria-label="关闭预览"
            >
              ✕
            </button>
            <img src={preview.url} alt={preview.alt || preview.filename} className="media__preview-img" />
            <div className="media__preview-info">
              <p className="media__preview-name" title={preview.filename}>
                {preview.filename}
              </p>
              <p className="media__preview-meta">
                {fmtSize(preview.filesize)}
                {preview.width && preview.height ? ` · ${preview.width}×${preview.height}` : ''}
                {' · '}
                {fmt(preview.createdAt)}
              </p>
              <p className="media__preview-alt">
                {preview.alt
                  ? `替代文本：${preview.alt}`
                  : '未设置替代文本（建议填写以提升 SEO）'}
              </p>
              <div className="media__preview-actions">
                <button
                  type="button"
                  className="manage__action"
                  onClick={() => {
                    openEdit(preview)
                    setPreview(null)
                  }}
                >
                  编辑替代文本
                </button>
                <button
                  type="button"
                  className="manage__action"
                  onClick={() => {
                    navigator.clipboard.writeText(preview.url).then(() => show('success', 'URL 已复制到剪贴板'))
                  }}
                >
                  复制 URL
                </button>
                <button
                  type="button"
                  className="manage__action manage__action--danger"
                  onClick={() => {
                    setConfirmDel(preview)
                    setPreview(null)
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑 alt 弹窗 */}
      {editing && (
        <div className="drafts__confirm-mask" onClick={() => !editBusy && setEditing(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>编辑替代文本</h3>
            <div className="media__edit-preview">
              <img src={editing.url} alt={editing.alt || editing.filename} />
            </div>
            <label className="media__edit-label" htmlFor="media-alt-input">
              替代文本（SEO 用）
            </label>
            <input
              id="media-alt-input"
              type="text"
              className="media__edit-input"
              value={editAlt}
              onChange={(e) => setEditAlt(e.target.value)}
              placeholder="例如：云计算服务架构图"
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !editBusy) void handleSaveAlt()
              }}
            />
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" disabled={editBusy} onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                disabled={editBusy}
                onClick={() => void handleSaveAlt()}
              >
                {editBusy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单条删除确认 */}
      {confirmDel && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmDel(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              确定删除「{confirmDel.filename}」吗？删除后无法恢复。
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
              确定删除选中的 {confirmBatchDelete.length} 张图片吗？删除后无法恢复。
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

export default MediaViewInner
