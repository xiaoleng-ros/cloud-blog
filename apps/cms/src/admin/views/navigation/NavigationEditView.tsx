'use client'

/**
 * 导航管理整页自定义视图（folder 替换 Payload 内置全局编辑页）
 *
 * 两个 Tab：
 *  1. 顶部导航：前台顶栏标签（导航文字 + 导航英文 + 排序权重 + 前台可见）
 *  2. 更多面板：前台「更多」下拉面板条目（导航文字 + 导航英文 + 图标 + 排序权重 + 前台可见）
 *
 * 两个弹窗的「链接」统一为二选一：站内页面（填导航英文，notes → /notes）或外部链接（手填 URL）。
 * 是否外链不再是独立开关，由链接类型推导 —— 两个开关并存时用户很容易填成
 * 「站内路径 + 勾了外链」，前台就会拿一个 /stats 去 target="_blank"。
 *
 * 数据通过 /api/globals/navigation GET/POST，底层是 topNav / morePanel 两个结构化数组。
 * 每次增删改都立即落库（没有「保存全部」按钮），提交按操作顺序串行入队，
 * 成功后由 afterChange hook 同步前台缓存。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Toast, useToast } from '../../components/Toast'
import { describeApiError, fetchGlobal, updateGlobal } from '../lib/api'
import {
  LINE_ICONS,
  BRAND_ICONS,
  brandRenderSize,
  brandTransform,
  hasIcon,
  iconInnerMarkup,
  isBrandIcon,
} from 'cloud-blog/shared/icon-paths'
import { isExternalHref, isValidExternalHref } from 'cloud-blog/shared/site-pages'
import { normalizeSiteHref } from 'cloud-blog/shared/free-text-lines'

/** 顶部导航项 */
interface TopNavItem {
  id: string
  label: string
  href: string
  sort: number
  visible: boolean
}

/** 更多面板条目 */
interface MorePanelItem {
  id: string
  label: string
  href: string
  icon: string
  external: boolean
  sort: number
  visible: boolean
}

/** 后台返回的原始数组项（id 是 Payload array 行标识） */
interface RawNavItem {
  id?: string
  label?: string
  href?: string
  sort?: number
  visible?: boolean
  icon?: string
  external?: boolean
}

/** 导航 Global 的 GET 形状 */
interface NavigationDoc {
  topNav?: RawNavItem[] | null
  morePanel?: RawNavItem[] | null
}

type Tab = 'top' | 'more'

/**
 * 链接类型：新建导航项时二选一。
 * - page：跳到站内页面（英文标识 notes → /notes，留空 = 首页）
 * - external：跳到站外地址（自己填完整 URL，前台新标签打开）
 */
type LinkType = 'page' | 'external'

/** Payload array 的每行 id 在 POST/PATCH 时不能传（会被当成关系字段），保存前剥掉 */
function stripIds<T extends { id?: string }>(items: T[]): Omit<T, 'id'>[] {
  return items.map(({ id: _id, ...rest }) => rest)
}

const ICON_OPTIONS = [...Object.keys(LINE_ICONS), ...Object.keys(BRAND_ICONS)]

/**
 * 在后台画一个图标。
 *
 * 和前台 Icon.astro 用同一张表、同一套渲染规则：线性图标走 stroke，
 * 品牌图标走 fill（品牌图形铺满 viewBox，按 brandRenderSize 收一档才视觉等大）。
 * 后台不引天价依赖，直接拿 shared 里的 path 字面量拼 SVG。
 */
function IconPreview({ name, size = 20 }: { name: string; size?: number }) {
  const isBrand = isBrandIcon(name)
  const inner = iconInnerMarkup(name)
  if (!inner) return null

  if (isBrand) {
    const brand = BRAND_ICONS[name]
    const renderSize = brandRenderSize(size)
    const transform = brandTransform(name)
    // 官方色写进内联自定义属性，由 admin-theme.css 的 .cat__brand-glyph 决定实际 fill：
    // X 的官方规范就是纯黑或纯白两种，深色底上必须换成白色那份，否则整块看不见。
    const style = brand.color
      ? ({
          '--glyph-color': brand.color,
          '--glyph-color-dark': brand.darkColor ?? brand.color,
        } as React.CSSProperties)
      : undefined
    return (
      <svg
        className="cat__brand-glyph"
        style={style}
        width={renderSize}
        height={renderSize}
        viewBox="0 0 24 24"
        aria-hidden="true"
        // path 字面量来自本项目 shared/icon-paths.ts，不是用户输入
        dangerouslySetInnerHTML={{ __html: `<g transform="${transform ?? ''}">${inner}</g>` }}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

/** 生成临时 id（编辑态用，保存时剥掉） */
const tempId = () => `tmp_${Math.random().toString(36).slice(2, 9)}`

export const NavigationEditView = () => {
  const [tab, setTab] = useState<Tab>('top')
  const [topNav, setTopNav] = useState<TopNavItem[]>([])
  const [morePanel, setMorePanel] = useState<MorePanelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const { toast, show } = useToast()

  /**
   * 数组的最新值镜像。
   *
   * setState 是异步的，而「立即落库」需要在同一次点击里拿到改动后的完整数组，
   * 所以每次提交同时写入 ref，供下一个操作读取，避免读到上一帧的旧值。
   */
  const topNavRef = useRef<TopNavItem[]>([])
  const morePanelRef = useRef<MorePanelItem[]>([])

  /**
   * 写入队列。
   *
   * 每个改动都会把「完整数组」整体 POST 回后台（Payload globals 只暴露整体替换），
   * 若两次提交并发，先发出的可能后到达并把后一次改动覆盖掉。这里用 Promise 串联，
   * 保证严格按操作顺序落地；队列前一项失败不阻塞后续项。
   */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  // 弹窗：顶部导航 / 更多面板 各自共用一套弹窗逻辑
  const [modal, setModal] = useState<
    | { kind: 'top'; mode: 'create' }
    | { kind: 'top'; mode: 'edit'; item: TopNavItem }
    | { kind: 'more'; mode: 'create' }
    | { kind: 'more'; mode: 'edit'; item: MorePanelItem }
    | null
  >(null)

  // 删除确认：先弹卡片问一句，避免误点「删除」直接把导航项打掉（删除是立即落库，没有撤销）
  const [confirmDel, setConfirmDel] = useState<
    { kind: 'top'; item: TopNavItem } | { kind: 'more'; item: MorePanelItem } | null
  >(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      const doc = await fetchGlobal<NavigationDoc>('navigation')
      const nextTop: TopNavItem[] = (doc?.topNav ?? []).map((r) => ({
        id: r.id ?? tempId(),
        label: r.label ?? '',
        href: r.href ?? '',
        sort: Number(r.sort ?? 0),
        visible: r.visible !== false,
      }))
      const nextMore: MorePanelItem[] = (doc?.morePanel ?? []).map((r) => ({
        id: r.id ?? tempId(),
        label: r.label ?? '',
        href: r.href ?? '',
        icon: r.icon ?? '',
        external: r.external === true,
        sort: Number(r.sort ?? 0),
        visible: r.visible !== false,
      }))
      topNavRef.current = nextTop
      morePanelRef.current = nextMore
      setTopNav(nextTop)
      setMorePanel(nextMore)
    } catch (e) {
      setLoadFailed(true)
      setError(describeApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 立即落库：把当前完整数组 POST 回后台。
   *
   * 为什么不走增量接口：Payload 3 的 globals 只有 POST /（整体替换），
   * 没有针对数组行的子路由，所以每次改动都提交完整快照。
   */
  const enqueuePersist = useCallback(
    (nextTop: TopNavItem[], nextMore: MorePanelItem[], successToast: string): Promise<void> => {
      const task = queueRef.current
        .catch(() => undefined) // 前一项失败不应阻塞后续提交
        .then(async () => {
          setError('')
          await updateGlobal<NavigationDoc>('navigation', {
            topNav: stripIds(nextTop),
            morePanel: stripIds(nextMore),
          })
          show('success', successToast)
        })
        .catch((e) => {
          const msg = describeApiError(e)
          setError(msg)
          show('error', msg)
        })
      queueRef.current = task
      return task
    },
    [show],
  )

  /** 提交两处数组的最新值（写 ref + setState + 落库，保证三者一致） */
  const commit = useCallback(
    (nextTop: TopNavItem[], nextMore: MorePanelItem[], successToast: string) => {
      topNavRef.current = nextTop
      morePanelRef.current = nextMore
      setTopNav(nextTop)
      setMorePanel(nextMore)
      void enqueuePersist(nextTop, nextMore, successToast)
    },
    [enqueuePersist],
  )

  // ----- 顶部导航 CRUD（全部立即落库） -----
  const addTop = () => setModal({ kind: 'top', mode: 'create' })
  const editTop = (item: TopNavItem) => setModal({ kind: 'top', mode: 'edit', item })
  /** 点「删除」只是打开确认卡片，真正落库在 doRemoveTop */
  const removeTop = (id: string) => {
    const target = topNavRef.current.find((i) => i.id === id)
    if (target) setConfirmDel({ kind: 'top', item: target })
  }
  const doRemoveTop = (id: string) => {
    setConfirmDel(null)
    const nextTop = topNavRef.current.filter((i) => i.id !== id)
    commit(nextTop, morePanelRef.current, '已删除')
  }
  const saveTop = (item: TopNavItem) => {
    const exists = topNavRef.current.some((i) => i.id === item.id)
    const nextTop = exists ? topNavRef.current.map((i) => (i.id === item.id ? item : i)) : [...topNavRef.current, item]
    setModal(null)
    commit(nextTop, morePanelRef.current, exists ? '已保存' : '已新增')
  }

  // ----- 更多面板 CRUD（同上） -----
  const addMore = () => setModal({ kind: 'more', mode: 'create' })
  const editMore = (item: MorePanelItem) => setModal({ kind: 'more', mode: 'edit', item })
  /** 同上：先确认再删 */
  const removeMore = (id: string) => {
    const target = morePanelRef.current.find((i) => i.id === id)
    if (target) setConfirmDel({ kind: 'more', item: target })
  }
  const doRemoveMore = (id: string) => {
    setConfirmDel(null)
    const nextMore = morePanelRef.current.filter((i) => i.id !== id)
    commit(topNavRef.current, nextMore, '已删除')
  }
  const saveMore = (item: MorePanelItem) => {
    const exists = morePanelRef.current.some((i) => i.id === item.id)
    const nextMore = exists
      ? morePanelRef.current.map((i) => (i.id === item.id ? item : i))
      : [...morePanelRef.current, item]
    setModal(null)
    commit(topNavRef.current, nextMore, exists ? '已保存' : '已新增')
  }

  const sortItems = <T extends { sort: number }>(items: T[]) => [...items].sort((a, b) => a.sort - b.sort)

  return (
    <div className="drafts cat">
      <PageHeader title="导航管理" />

      {/* Tab 切换 */}
      <div className="cat__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'top'}
          className={`cat__tab${tab === 'top' ? ' cat__tab--active' : ''}`}
          onClick={() => setTab('top')}
        >
          顶部导航
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'more'}
          className={`cat__tab${tab === 'more' ? ' cat__tab--active' : ''}`}
          onClick={() => setTab('more')}
        >
          更多面板
        </button>
      </div>

      <div className="cat__panel">
        {loading ? (
          <p className="drafts__empty">加载中…</p>
        ) : loadFailed ? (
          <p className="drafts__empty">未能读取导航配置。{error}</p>
        ) : tab === 'top' ? (
          <TopNavList items={sortItems(topNav)} onAdd={addTop} onEdit={editTop} onDelete={removeTop} />
        ) : (
          <MorePanelList items={sortItems(morePanel)} onAdd={addMore} onEdit={editMore} onDelete={removeMore} />
        )}
      </div>

      {error && (
        <p className="cat__error" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {modal && modal.kind === 'top' && (
        <TopNavModal
          mode={modal.mode}
          initial={modal.mode === 'edit' ? modal.item : undefined}
          onClose={() => setModal(null)}
          onSaved={saveTop}
        />
      )}

      {modal && modal.kind === 'more' && (
        <MorePanelModal
          mode={modal.mode}
          initial={modal.mode === 'edit' ? modal.item : undefined}
          onClose={() => setModal(null)}
          onSaved={saveMore}
        />
      )}

      {/* 删除确认卡片：删除即写库、不可撤销，所以多问一句
          （与分类/标签/友链等页面的 drafts__confirm 保持同一套外观） */}
      {confirmDel && (
        <div className="drafts__confirm-mask" onClick={() => setConfirmDel(null)}>
          <div className="drafts__confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>
              {confirmDel.kind === 'top' ? '顶部导航项' : '更多面板条目'}「{confirmDel.item.label || '未命名'}
              」将被删除，前台会立即消失。确定继续吗？
            </p>
            <div className="drafts__confirm-actions">
              <button type="button" className="drafts__op" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button
                type="button"
                className="drafts__op drafts__op--danger"
                onClick={() => {
                  if (confirmDel.kind === 'top') doRemoveTop(confirmDel.item.id)
                  else doRemoveMore(confirmDel.item.id)
                }}
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

/* ========================== 顶部导航列表 ========================== */

function TopNavList({
  items,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: TopNavItem[]
  onAdd: () => void
  onEdit: (item: TopNavItem) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <div className="cat__toolbar">
        <div className="cat__tools">
          <button type="button" className="manage__create" onClick={onAdd}>
            新增
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="cat__empty">
          <span className="cat__empty-icon" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
            </svg>
          </span>
          <h3>还没有导航项</h3>
          <p>顶部导航标签展示在前台顶栏，支持站内路径与外链</p>
          <button type="button" className="manage__create" onClick={onAdd}>
            新增
          </button>
        </div>
      ) : (
        <div className="cat__tree">
          {items.map((item) => (
            <div className="cat__row" key={item.id}>
              <span className="cat__name">{item.label}</span>
              <code className="cat__slug">{item.href}</code>
              {item.visible === false && <i className="cat__tag cat__tag--hidden">已隐藏</i>}
              <span className="cat__weight">{Number(item.sort ?? 0) || ''}</span>
              <span className="cat__row-actions">
                <button type="button" className="drafts__op" onClick={() => onEdit(item)}>
                  编辑
                </button>
                <button type="button" className="drafts__op drafts__op--danger" onClick={() => onDelete(item.id)}>
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ========================== 更多面板列表 ========================== */

function MorePanelList({
  items,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: MorePanelItem[]
  onAdd: () => void
  onEdit: (item: MorePanelItem) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <div className="cat__toolbar">
        <div className="cat__tools">
          <button type="button" className="manage__create" onClick={onAdd}>
            新增
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="cat__empty">
          <span className="cat__empty-icon" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </span>
          <h3>还没有条目</h3>
          <p>「更多」面板是前台顶栏「更多 ∧」下拉里的快捷入口</p>
          <button type="button" className="manage__create" onClick={onAdd}>
            新增
          </button>
        </div>
      ) : (
        <div className="cat__tree">
          {items.map((item) => (
            <div className="cat__row" key={item.id}>
              <span className="cat__name">{item.label}</span>
              <code className="cat__slug">{item.href}</code>
              {item.icon && <i className="cat__tag">{item.icon}</i>}
              {item.external && <i className="cat__tag">外链</i>}
              {item.visible === false && <i className="cat__tag cat__tag--hidden">已隐藏</i>}
              <span className="cat__weight">{Number(item.sort ?? 0) || ''}</span>
              <span className="cat__row-actions">
                <button type="button" className="drafts__op" onClick={() => onEdit(item)}>
                  编辑
                </button>
                <button type="button" className="drafts__op drafts__op--danger" onClick={() => onDelete(item.id)}>
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ========================== 导航英文 / 链接类型（两个弹窗共用） ========================== */

/**
 * 站内英文标识 → 站内地址。
 *
 * 「随笔」页面在站里的英文标识就是 notes，用户填 notes 比填 /notes 顺，
 * 也避免了「有人填 notes 有人填 /notes」两套数据。前导/尾随斜杠都吃掉，
 * 留空表示首页（/）。
 */
function slugToHref(slug: string): string {
  const clean = slug.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return clean ? normalizeSiteHref(`/${clean}`) : '/'
}

/** 反向：把已存在的站内地址还原成英文标识，供编辑态回填（/notes → notes，/ → 空） */
function hrefToSlug(href: string): string {
  return href.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 「导航英文」+「链接类型」两个字段，两个弹窗共用。
 *
 * 站内页面走英文标识（notes → /notes），外部链接走完整 URL。
 * 是否在新标签打开由类型推导，不再让用户单独勾「外链」——两个开关并存时
 * 很容易填成「站内路径 + 勾了外链」，前台就会拿一个 /stats 去 target="_blank"。
 *
 * 英文标识是给「新增的页面」自己起名的，所以只给一个干净的输入框：
 * 不做下拉补全，也不强制它必须命中现有静态路由（动态页如 tags/astro 同样合法）。
 */
function NavigationLinkFields({
  linkType,
  onLinkTypeChange,
  slug,
  onSlugChange,
  externalHref,
  onExternalHrefChange,
  resolvedHref,
  slugLabel = '导航英文',
}: {
  linkType: LinkType
  onLinkTypeChange: (next: LinkType) => void
  slug: string
  onSlugChange: (next: string) => void
  externalHref: string
  onExternalHrefChange: (next: string) => void
  resolvedHref: string
  slugLabel?: string
}) {
  return (
    <>
      <label className="cat__field">
        <span className="cat__label">{slugLabel}</span>
        <input
          className="cat__input"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          placeholder="例如：notes"
          aria-label={slugLabel}
        />
        <span className="cat__hint">
          新页面自己起的英文标识（随笔是 <code>notes</code>），保存后地址是 <code>{slugToHref(slug)}</code>
        </span>
      </label>

      <div className="cat__field">
        <span className="cat__label">链接类型</span>
        <div className="cat__segmented" role="radiogroup" aria-label="链接类型">
          <button
            type="button"
            role="radio"
            aria-checked={linkType === 'page'}
            className={`cat__seg${linkType === 'page' ? ' cat__seg--active' : ''}`}
            onClick={() => onLinkTypeChange('page')}
          >
            站内页面
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={linkType === 'external'}
            className={`cat__seg${linkType === 'external' ? ' cat__seg--active' : ''}`}
            onClick={() => onLinkTypeChange('external')}
          >
            外部链接
          </button>
        </div>
      </div>

      {linkType === 'external' && (
        <label className="cat__field">
          <span className="cat__label">网址</span>
          <input
            className="cat__input"
            value={externalHref}
            onChange={(e) => onExternalHrefChange(e.target.value)}
            placeholder="https://github.com/yourname"
            aria-label="外部链接地址"
          />
          <span className="cat__hint">前台会在新标签页打开</span>
        </label>
      )}

      {/* 最终写入的值透明可见：用户能立刻确认拼出来的地址没写错 */}
      <span className="cat__hint">
        {linkType === 'external' ? '跳转到外部地址' : '前台在当前标签页跳转'} · 将保存为{' '}
        <code>{resolvedHref || '（未填写）'}</code>
      </span>
    </>
  )
}

/* ========================== 顶部导航弹窗 ========================== */

function TopNavModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial?: TopNavItem
  onClose: () => void
  onSaved: (item: TopNavItem) => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  // 链接类型：站内已有页面（按英文标识拼路径）还是外部跳转地址（手填 URL）
  const [linkType, setLinkType] = useState<LinkType>(() =>
    initial?.href && isExternalHref(initial.href) ? 'external' : 'page',
  )
  // 导航英文：站内地址去掉前导斜杠（/notes → notes，/ → 空）
  const [slug, setSlug] = useState(() =>
    initial?.href && !isExternalHref(initial.href) ? hrefToSlug(initial.href) : '',
  )
  const [externalHref, setExternalHref] = useState(initial?.href && isExternalHref(initial.href) ? initial.href : '')
  const [sort, setSort] = useState<string>(String(initial?.sort ?? 0))
  const [visible, setVisible] = useState<boolean>(initial?.visible !== false)
  const [error, setError] = useState('')

  /** 当前本次提交最终会写入的 href（供预览与校验共用） */
  const resolvedHref = linkType === 'external' ? externalHref.trim() : slugToHref(slug)

  const submit = () => {
    if (!label.trim()) {
      setError('请填写导航文字')
      return
    }
    if (linkType === 'external') {
      if (!externalHref.trim()) {
        setError('请填写外部链接地址')
        return
      }
      if (!isValidExternalHref(externalHref)) {
        setError('外部链接需以 http://、https://、mailto: 或 tel: 开头')
        return
      }
    } else if (/[\s?#]/.test(slug.trim())) {
      setError('导航英文只能填英文字母、数字、连字符和斜杠')
      return
    }
    onSaved({
      id: initial?.id ?? tempId(),
      label: label.trim(),
      href: resolvedHref,
      sort: Number(sort) || 0,
      visible,
    })
  }

  return (
    <div className="drafts__confirm-mask" onClick={onClose}>
      <div className="cat__modal" onClick={(e) => e.stopPropagation()}>
        <header className="cat__modal-head">
          <span className="cat__modal-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2 2 7l10 5 10-5-10-5Z" />
              <path d="m2 17 10 5 10-5" />
            </svg>
          </span>
          <div>
            <h3>{mode === 'create' ? '新增导航项' : '编辑导航项'}</h3>
            <p>顶部导航标签，展示在前台顶栏</p>
          </div>
          <button type="button" className="cat__modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="cat__form">
          <label className="cat__field">
            <span className="cat__label">导航文字</span>
            <input
              className="cat__input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例如：首页"
            />
          </label>

          <NavigationLinkFields
            linkType={linkType}
            onLinkTypeChange={setLinkType}
            slug={slug}
            onSlugChange={setSlug}
            externalHref={externalHref}
            onExternalHrefChange={setExternalHref}
            resolvedHref={resolvedHref}
          />

          <div className="cat__row2">
            <label className="cat__field">
              <span className="cat__label">
                排序权重 <i>（可选）</i>
              </span>
              <input
                className="cat__input"
                type="number"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="cat__field">
              <span className="cat__label">
                前台可见 <i>（可选）</i>
              </span>
              <div className="cat__segmented" role="radiogroup" aria-label="前台可见">
                <button
                  type="button"
                  role="radio"
                  aria-checked={visible}
                  className={`cat__seg${visible ? ' cat__seg--active' : ''}`}
                  onClick={() => setVisible(true)}
                >
                  显示
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!visible}
                  className={`cat__seg${!visible ? ' cat__seg--active' : ''}`}
                  onClick={() => setVisible(false)}
                >
                  隐藏
                </button>
              </div>
            </label>
          </div>

          {error && <p className="cat__error">{error}</p>}
        </div>

        <footer className="cat__modal-foot">
          <button type="button" className="cat__btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="cat__btn cat__btn--primary" onClick={submit}>
            {mode === 'create' ? '新增' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ========================== 更多面板弹窗 ========================== */

function MorePanelModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial?: MorePanelItem
  onClose: () => void
  onSaved: (item: MorePanelItem) => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  // 与顶部导航同一套二选一：站内页面 vs 外部链接
  const [linkType, setLinkType] = useState<LinkType>(() => (initial?.external ? 'external' : 'page')) // 导航英文：站内地址去掉前导斜杠（/notes → notes，/ → 空）
  const [slug, setSlug] = useState(() =>
    initial?.href && !isExternalHref(initial.href) ? hrefToSlug(initial.href) : '',
  )
  const [externalHref, setExternalHref] = useState(initial?.href && isExternalHref(initial.href) ? initial.href : '')
  const [icon, setIcon] = useState(initial?.icon ?? '')
  const [sort, setSort] = useState<string>(String(initial?.sort ?? 0))
  const [visible, setVisible] = useState<boolean>(initial?.visible !== false)
  const [error, setError] = useState('')

  const resolvedHref = linkType === 'external' ? externalHref.trim() : slugToHref(slug)

  const submit = () => {
    if (!label.trim()) {
      setError('请填写导航文字')
      return
    }
    if (linkType === 'external') {
      if (!externalHref.trim()) {
        setError('请填写外部链接地址')
        return
      }
      if (!isValidExternalHref(externalHref)) {
        setError('外部链接需以 http://、https://、mailto: 或 tel: 开头')
        return
      }
    } else if (/[\s?#]/.test(slug.trim())) {
      setError('导航英文只能填英文字母、数字、连字符和斜杠')
      return
    }
    if (icon && !hasIcon(icon)) {
      setError(`图标名「${icon}」不存在，请从图标面板重新选择`)
      return
    }
    onSaved({
      id: initial?.id ?? tempId(),
      label: label.trim(),
      href: resolvedHref,
      icon: icon.trim(),
      // external 由链接类型推导，不再让用户单独勾选（两处开关容易互相打架）
      external: linkType === 'external',
      sort: Number(sort) || 0,
      visible,
    })
  }

  return (
    <div className="drafts__confirm-mask" onClick={onClose}>
      <div className="cat__modal" onClick={(e) => e.stopPropagation()}>
        <header className="cat__modal-head">
          <span className="cat__modal-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </span>
          <div>
            <h3>{mode === 'create' ? '新增条目' : '编辑条目'}</h3>
            <p>前台「更多 ∧」下拉面板里的快捷入口</p>
          </div>
          <button type="button" className="cat__modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="cat__form">
          <label className="cat__field">
            <span className="cat__label">导航文字</span>
            <input
              className="cat__input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例如：统计"
            />
          </label>

          <NavigationLinkFields
            linkType={linkType}
            onLinkTypeChange={setLinkType}
            slug={slug}
            onSlugChange={setSlug}
            externalHref={externalHref}
            onExternalHrefChange={setExternalHref}
            resolvedHref={resolvedHref}
          />

          <div className="cat__field">
            <span className="cat__label">
              图标 <i>（可选）</i>
            </span>
            {/* 图形选择器：纯文字下拉里看不出「spark」和「globe」差在哪，
                这里直接铺成网格，点哪个就是哪个 */}
            <div className="cat__icon-grid" role="radiogroup" aria-label="图标">
              <button
                type="button"
                role="radio"
                aria-checked={icon === ''}
                aria-label="无图标"
                title="无图标"
                className={`cat__icon-cell${icon === '' ? ' cat__icon-cell--active' : ''}`}
                onClick={() => setIcon('')}
              >
                <span className="cat__icon-none">无</span>
              </button>
              {ICON_OPTIONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={icon === name}
                  aria-label={name}
                  title={name}
                  className={`cat__icon-cell${icon === name ? ' cat__icon-cell--active' : ''}`}
                  onClick={() => setIcon(name)}
                >
                  <IconPreview name={name} size={20} />
                </button>
              ))}
            </div>
            <span className="cat__hint">
              {icon ? (
                <>
                  已选 <code>{icon}</code>
                  {isBrandIcon(icon) ? '（品牌图形）' : '（线性图形）'}
                </>
              ) : (
                '不选则只显示文字'
              )}
            </span>
          </div>

          <div className="cat__row2">
            <label className="cat__field">
              <span className="cat__label">
                排序权重 <i>（可选）</i>
              </span>
              <input
                className="cat__input"
                type="number"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="cat__field">
              <span className="cat__label">
                前台可见 <i>（可选）</i>
              </span>
              <div className="cat__segmented" role="radiogroup" aria-label="前台可见">
                <button
                  type="button"
                  role="radio"
                  aria-checked={visible}
                  className={`cat__seg${visible ? ' cat__seg--active' : ''}`}
                  onClick={() => setVisible(true)}
                >
                  显示
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!visible}
                  className={`cat__seg${!visible ? ' cat__seg--active' : ''}`}
                  onClick={() => setVisible(false)}
                >
                  隐藏
                </button>
              </div>
            </label>
          </div>

          {error && <p className="cat__error">{error}</p>}
        </div>

        <footer className="cat__modal-foot">
          <button type="button" className="cat__btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="cat__btn cat__btn--primary" onClick={submit}>
            {mode === 'create' ? '新增' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default NavigationEditView
