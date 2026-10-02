'use client'

/**
 * 分类管理树视图（替换 Payload 默认列表）
 *
 * 版式对齐设计图：页头「分类管理」+ 新增分类；工具栏（类型图例 / 搜索名称或标识 / 全部展开、折叠）；
 * 树形行（缩进 + 展开箭头 + 类型色点 + 名称 + 标识 + 隐藏标记 + 编辑/删除）。
 *
 * - 数据一次全量拉取，客户端建树（权重→名称排序）；搜索命中保留祖先并临时展开
 * - 新建 / 编辑走 CategoryModal；删除复用确认框样式，后端 beforeDelete 会给可读报错
 * - 加载中仅刷新数据区，页头 / 工具栏骨架常驻
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { deleteCategory, listCategoryDocs, type CategoryDoc } from '../lib/api'
import { CategoryModal, flattenWithDepth, parentIdOf } from './CategoryModal'

interface TreeNode {
  doc: CategoryDoc
  children: TreeNode[]
}

interface FlatRow {
  doc: CategoryDoc
  depth: number
  hasChildren: boolean
}

/** 建树：孤儿/环内节点兜底挂到根，保证任何数据形态都不丢行 */
function buildTree(docs: CategoryDoc[]): TreeNode[] {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const childMap = new Map<number, CategoryDoc[]>()
  const roots: CategoryDoc[] = []
  for (const d of docs) {
    const p = parentIdOf(d)
    if (p == null || !byId.has(p)) roots.push(d)
    else childMap.set(p, [...(childMap.get(p) ?? []), d])
  }
  const cmp = (a: CategoryDoc, b: CategoryDoc) =>
    (Number(a.sort ?? 0) - Number(b.sort ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh')

  const toNode = (d: CategoryDoc, seen: Set<number>): TreeNode => {
    seen.add(d.id)
    const children = [...(childMap.get(d.id) ?? [])]
      .filter((c) => !seen.has(c.id))
      .sort(cmp)
      .map((c) => toNode(c, seen))
    return { doc: d, children }
  }
  const seen = new Set<number>()
  const tree = [...roots].sort(cmp).map((r) => toNode(r, seen))
  // 环内不可达节点（理论上被 beforeChange 拦截）：按根展示，避免整棵子树消失
  const orphans = docs.filter((d) => !seen.has(d.id)).sort(cmp)
  for (const o of orphans) tree.push({ doc: o, children: [] })
  return tree
}

/** 搜索命中集合：匹配节点 + 其全部祖先 */
function keepSetForKeyword(docs: CategoryDoc[], kw: string): Set<number> | null {
  if (!kw) return null
  const byId = new Map(docs.map((d) => [d.id, d]))
  const keep = new Set<number>()
  for (const d of docs) {
    const hay = `${d.name ?? ''} ${d.slug ?? ''}`.toLowerCase()
    if (!hay.includes(kw)) continue
    let cur: CategoryDoc | undefined = d
    const guard = new Set<number>()
    while (cur && !guard.has(cur.id)) {
      keep.add(cur.id)
      guard.add(cur.id)
      const p = parentIdOf(cur)
      cur = p != null ? byId.get(p) : undefined
    }
  }
  return keep
}

function flatten(tree: TreeNode[], collapsed: Set<number>, keep: Set<number> | null, out: FlatRow[], depth = 0) {
  for (const node of tree) {
    if (keep && !keep.has(node.doc.id)) continue
    out.push({ doc: node.doc, depth, hasChildren: node.children.length > 0 })
    // 搜索态强制展开，保证命中路径可见
    const expanded = keep ? true : !collapsed.has(node.doc.id)
    if (node.children.length && expanded) flatten(node.children, collapsed, keep, out, depth + 1)
  }
}

const TYPE_LABEL: Record<string, string> = { category: '分类', page: '页面', nav: '导航' }

export const CategoriesViewInner = () => {
  const [docs, setDocs] = useState<CategoryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; doc: CategoryDoc } | null>(null)
  const [confirmDel, setConfirmDel] = useState<CategoryDoc | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocs(await listCategoryDocs())
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const tree = buildTree(docs)
    const keep = keepSetForKeyword(docs, keyword.trim().toLowerCase())
    const out: FlatRow[] = []
    flatten(tree, collapsed, keep, out)
    return out
  }, [docs, collapsed, keyword])

  const parentIdsWithChildren = useMemo(() => {
    const s = new Set<number>()
    for (const d of docs) {
      const p = parentIdOf(d)
      if (p != null) s.add(p)
    }
    return s
  }, [docs])

  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => setCollapsed(parentIdsWithChildren)

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteCategory(confirmDel.id)
      setConfirmDel(null)
      await load()
    } catch (e) {
      alert((e as Error).message)
      setConfirmDel(null)
    } finally {
      setBusy(false)
    }
  }

  const kw = keyword.trim()

  return (
    <div className="drafts cat">
      <PageHeader
        title="分类管理"
        actions={
          <button type="button" className="manage__create" onClick={() => setModal({ mode: 'create' })}>
            + 新增分类
          </button>
        }
      />

      <div className="cat__panel">
        {/* 工具栏：图例 + 搜索 + 展开/折叠 */}
        <div className="cat__toolbar">
          <div className="cat__legend" aria-hidden="true">
            <span>
              <i className="cat__dot cat__dot--category" />分类
            </span>
            <span>
              <i className="cat__dot cat__dot--page" />页面
            </span>
            <span>
              <i className="cat__dot cat__dot--nav" />导航
            </span>
          </div>
          <div className="cat__tools">
            <input
              type="search"
              className="trash__search cat__search"
              placeholder="搜索名称或标识..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索名称或标识"
            />
            <button type="button" className="cat__tool-btn" onClick={expandAll} title="全部展开" aria-label="全部展开">
              ⇊
            </button>
            <button type="button" className="cat__tool-btn" onClick={collapseAll} title="全部折叠" aria-label="全部折叠">
              ⇈
            </button>
          </div>
        </div>

        <div className="cat__tree">
          {loading ? (
            <p className="drafts__empty">加载中…</p>
          ) : docs.length === 0 ? (
            <div className="cat__empty">
              <span className="cat__empty-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                </svg>
              </span>
              <h3>还没有分类</h3>
              <p>分类用于组织文章归档，页面用于站内菜单，导航用于外链跳转</p>
              <button type="button" className="manage__create" onClick={() => setModal({ mode: 'create' })}>
                + 创建第一个分类
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="drafts__empty">未找到匹配「{kw}」的分类</p>
          ) : (
            rows.map((row) => {
              const d = row.doc
              const type = d.nodeType ?? 'category'
              const hasChildren = row.hasChildren
              const isOpen = keyword.trim() ? true : !collapsed.has(d.id)
              return (
                <div className="cat__row" key={d.id} style={{ paddingLeft: 14 + row.depth * 24 }}>
                  {hasChildren ? (
                    <button
                      type="button"
                      className={`cat__disclosure${isOpen ? ' cat__disclosure--open' : ''}`}
                      onClick={() => toggle(d.id)}
                      aria-label={isOpen ? '折叠' : '展开'}
                    >
                      ▸
                    </button>
                  ) : (
                    <span className="cat__disclosure-spacer" />
                  )}
                  <i className={`cat__dot cat__dot--${type}`} aria-hidden="true" />
                  <span className="cat__name" title={TYPE_LABEL[type]}>
                    {d.name}
                  </span>
                  {d.slug && <code className="cat__slug">{d.slug}</code>}
                  {d.visible === false && <i className="cat__tag cat__tag--hidden">已隐藏</i>}
                  {type !== 'category' && <i className="cat__tag">{TYPE_LABEL[type]}</i>}
                  <span className="cat__weight">{Number(d.sort ?? 0) || ''}</span>
                  <span className="cat__row-actions">
                    <button type="button" className="drafts__op" onClick={() => setModal({ mode: 'edit', doc: d })}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="drafts__op drafts__op--danger"
                      onClick={() => setConfirmDel(d)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {modal && (
        <CategoryModal
          mode={modal.mode}
          initial={modal.mode === 'edit' ? modal.doc : undefined}
          docs={docs}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            void load()
          }}
        />
      )}

      {confirmDel && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmDel(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              确定删除分类「{confirmDel.name}」吗？被内容引用或有子分类时会被拦截。
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

export default CategoriesViewInner
