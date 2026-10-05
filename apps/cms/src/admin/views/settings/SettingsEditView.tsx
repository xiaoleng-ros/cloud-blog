'use client'

/**
 * 站点设置整页自定义视图（替换 Payload 内置全局编辑页）
 *
 * 版式对齐参考图：左侧竖排配置菜单（图标 + 标题 + 说明，选中高亮 + 圆点），
 * 右侧内容面板（分区标题 + 字段 + 底部整宽保存按钮）。
 *
 * - 数据不走 Payload 表单上下文：GET/PATCH /api/site-settings 自管理，字段全为字符串
 * - 社交链接复用 SocialLinksField 的解析/序列化，保持「平台 链接」文本格式不变
 * - 保存只发「与加载基线有差异的字段」，落盘前重读 updatedAt 做冲突检测（root 替换后无 Payload 文档锁）
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// 客户端在首帧绘制前跑（消除分区闪回），SSR 无 window 时退化为 useEffect 避免告警
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
import {
  notesFromBatch,
  notesToBatch,
  parseNotes,
  parseSkills,
  PRESET_COLORS,
  skillsFromBatch,
  skillsToBatch,
  legacyHtmlToMarker,
  stringifyNotes,
  stringifySkills,
  type NoteItem,
  type SkillItem,
} from 'cloud-blog/shared/about-format'
import { PageHeader } from '../../components/PageHeader'
import { DateField } from '../../components/DateField'
import { CoverUploader } from '../../components/CoverUploader'
import {
  parseSocials,
  PLATFORM_OPTIONS,
  stringifySocials,
  type Platform,
} from '../../components/SocialLinksField'
import { describeApiError, fetchGlobal, updateGlobal } from '../lib/api'

/** 字段定义：text 单行、textarea 多行、date 自定义日历；span=2 占满整行 */
interface FieldDef {
  name: string
  label: string
  type: 'text' | 'textarea' | 'date'
  editor?: 'notes' | 'skills' | 'footer'
  /** uploader = 图片上传器（与正文封面共用 CoverUploader，值同样是图片地址） */
  widget?: 'uploader'
  required?: boolean
  placeholder?: string
  hint?: string
  rows?: number
  span?: 1 | 2
  /** 整行字段收窄展示（正文这类短文本不需要铺满） */
  narrow?: boolean
}

interface SectionDef {
  key: string
  title: string
  desc: string
  icon: ReactNode
  fields: FieldDef[]
}

/** 18px 线性图标，风格与回收站/分类页一致 */
const icon = (path: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const SECTIONS: SectionDef[] = [
  {
    key: 'site',
    title: '站点信息',
    desc: '站点名称、作者与第三方服务',
    icon: icon(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
      </>,
    ),
    fields: [
      { name: 'siteName', label: '站点名称', type: 'text', required: true },
      { name: 'siteAuthor', label: '作者', type: 'text' },
      { name: 'githubUser', label: 'GitHub 用户名', type: 'text' },
      { name: 'githubRepo', label: 'GitHub 仓库地址', type: 'text' },
      { name: 'neteasePlaylistId', label: '网易云歌单 ID', type: 'text' },
      { name: 'siteDescription', label: '站点简介', type: 'textarea', span: 2, rows: 3 },
    ],
  },
  {
    key: 'site-config',
    title: '网站配置',
    desc: '图标、备案号与创建时间',
    icon: icon(
      <>
        <path d="M4 7h8M18 7h2M4 12h2M12 12h8M4 17h6M16 17h4" />
        <circle cx="15" cy="7" r="2.2" />
        <circle cx="9" cy="12" r="2.2" />
        <circle cx="13.5" cy="17" r="2.2" />
      </>,
    ),
    fields: [
      { name: 'siteIcon', label: '网站图标', type: 'text', span: 2, widget: 'uploader' },
      {
        name: 'siteIcp',
        label: 'ICP 备案号',
        type: 'text',
        span: 2,
        placeholder: '例：豫ICP备2020031040号-1',
      },
      { name: 'siteCreatedAt', label: '网站创建时间', type: 'date', span: 2 },
    ],
  },
  {
    key: 'hero',
    title: '首页 Hero',
    desc: '问候语、名字与介绍文字',
    icon: icon(
      <>
        <path d="M4 5h16v10H4z" />
        <path d="M9 19h6M12 15v4" />
      </>,
    ),
    fields: [
      { name: 'greeting', label: '问候语', type: 'text' },
      { name: 'name', label: '名字', type: 'text' },
      { name: 'subtitle', label: '副标题', type: 'text', span: 2 },
      { name: 'bio', label: '介绍文字', type: 'textarea', span: 2, rows: 4 },
      { name: 'buttonLabel', label: '浏览文章按钮文字', type: 'text', span: 2 },
    ],
  },
  {
    key: 'socials',
    title: '社交链接',
    desc: '头像旁的社交平台图标',
    icon: icon(
      <>
        <circle cx="6" cy="12" r="2.6" />
        <circle cx="17.5" cy="6" r="2.6" />
        <circle cx="17.5" cy="18" r="2.6" />
        <path d="m8.4 10.8 6.8-3.6M8.4 13.2l6.8 3.6" />
      </>,
    ),
    fields: [{ name: 'socials', label: '社交链接', type: 'textarea', span: 2 }],
  },
  {
    key: 'footer',
    title: '页脚',
    desc: '页脚副标题、链接与群组',
    icon: icon(
      <>
        <path d="M4 5h16M4 10h16M4 15h10M4 20h16" />
      </>,
    ),
    fields: [
      { name: 'footerSubtitle', label: '页脚副标题', type: 'text', span: 2 },
      {
        name: 'footerChannels',
        label: '页脚链接',
        type: 'textarea',
        editor: 'footer',
        span: 2,
        rows: 5,
        hint: '名称首词命中图标才有图形：Bilibili / YouTube / RSS / X / 抖音 / 小红书 / 网易云音乐 / QQ / 微信 / GitHub，或线性图标名（mail / archive / globe…），其余按文字展示。http 链接新标签打开。',
      },
      {
        name: 'footerGroups',
        label: '页脚群组',
        type: 'textarea',
        editor: 'footer',
        span: 2,
        rows: 4,
        hint: '链接可留空，只填名称时前台展示为纯文字标签。支持 QQ / 微信图标。',
      },
    ],
  },
  {
    key: 'about',
    title: '关于页',
    desc: '关于页标题、正文与便签',
    icon: icon(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>,
    ),
    fields: [
      { name: 'aboutLead', label: '关于页大标题', type: 'text', span: 2, narrow: true },
      {
        name: 'aboutParagraphs',
        label: '关于页正文',
        type: 'textarea',
        span: 2,
        narrow: true,
        rows: 6,
        hint: '一行一段，想换行直接回车；给部分文字加高亮写成 ==这样== 即可，不需要懂 HTML。',
      },
      {
        name: 'aboutNotes',
        label: '关于页便签',
        type: 'textarea',
        editor: 'notes',
        span: 2,
        rows: 4,
        hint: '每条便签一行：标题、副文字，颜色点色板即选（含自定义任意色）。',
      },
      {
        name: 'skills',
        label: '技能环',
        type: 'textarea',
        editor: 'skills',
        span: 2,
        rows: 6,
        hint: '每条技能一行：名称、副标题、数值 0-100，颜色点色板即选（含自定义任意色）。',
      },
    ],
  },
]

type Values = Record<string, string>

const emptyValues = (): Values => ({})

/** 全部字段名（打平各分区），用于「脏字段集合」与冲突比对的基准 */
const ALL_FIELD_NAMES: string[] = SECTIONS.flatMap((s) => s.fields.map((f) => f.name))

/** 带 updatedAt 的全局文档切片（updatedAt 用于保存前冲突检测） */
type GlobalDoc = Record<string, unknown> & { updatedAt?: string }

/** 从文档抽取本视图关心的字段值（缺省补空串） */
const pickValues = (doc: GlobalDoc | null | undefined): Values => {
  const next: Values = {}
  for (const name of ALL_FIELD_NAMES) {
    const v = doc?.[name]
    let s = typeof v === 'string' ? v : ''
    // 存量正文可能还是旧 HTML 写法（marker-highlight span / <br>）：
    // 载入即转成 ==记号==，用户第一次保存后字段里就不再有 HTML
    if (name === 'aboutParagraphs') s = legacyHtmlToMarker(s)
    next[name] = s
  }
  return next
}

export const SettingsEditView = () => {
  const [values, setValues] = useState<Values>(emptyValues)
  // 加载基线：与 values 做 diff 得到脏字段，PATCH 只发这部分的改动
  const [baseline, setBaseline] = useState<Values>(emptyValues)
  const [loading, setLoading] = useState(true)
  // 加载失败 / 冲突（他人已改）：锁存并提示重载，禁止落盘（root 替换后 Payload 文档锁失效，需自行防覆盖）
  const [loadFailed, setLoadFailed] = useState(false)
  const [conflict, setConflict] = useState(false)
  // null = 尚未从 URL 判定分区：SSR 首帧不预选「站点信息」，避免刷新时先闪错误分区
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const loadedUpdatedAtRef = useRef('')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    setConflict(false)
    setError('')
    try {
      const doc = await fetchGlobal<GlobalDoc>('site-settings')
      const next = pickValues(doc)
      setValues(next)
      setBaseline(next)
      loadedUpdatedAtRef.current = typeof doc?.updatedAt === 'string' ? doc.updatedAt : ''
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

  // 刷新/直达后停留在同一分区：水合后首帧绘制前从 location.hash 判定，无效哈希回落默认分区
  useIsoLayoutEffect(() => {
    const restore = () => {
      const hash = window.location.hash.replace(/^#/, '')
      setActive(SECTIONS.some((s) => s.key === hash) ? hash : SECTIONS[0].key)
    }
    restore()
    window.addEventListener('hashchange', restore)
    return () => window.removeEventListener('hashchange', restore)
  }, [])

  const goSection = useCallback((key: string) => {
    setActive(key)
    window.history.replaceState(null, '', `#${key}`)
  }, [])

  // 「已保存 ✓」提示到点自动收起，卸载时清掉未触发的定时器
  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const setValue = useCallback((name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }))
    setSaved(false)
  }, [])

  const section = useMemo(() => SECTIONS.find((s) => s.key === active) ?? SECTIONS[0], [active])

  // 与基线的差异字段：无差异则不发空 PATCH
  const dirty = useMemo(() => {
    const out: Values = {}
    for (const name of ALL_FIELD_NAMES) {
      if ((values[name] ?? '') !== (baseline[name] ?? '')) out[name] = values[name] ?? ''
    }
    return out
  }, [values, baseline])

  const hasDirty = Object.keys(dirty).length > 0

  const save = async () => {
    if (!values.siteName?.trim()) {
      goSection('site')
      setError('站点名称不能为空')
      return
    }
    if (!hasDirty) return
    setBusy(true)
    setError('')
    try {
      // 落盘前重读全局文档：updatedAt 变化说明他人/他处已改，拒绝覆盖并提示重载
      const latest = await fetchGlobal<GlobalDoc>('site-settings')
      const latestUpdatedAt = typeof latest?.updatedAt === 'string' ? latest.updatedAt : ''
      if (
        loadedUpdatedAtRef.current &&
        latestUpdatedAt &&
        latestUpdatedAt !== loadedUpdatedAtRef.current
      ) {
        setConflict(true)
        setError('站点设置已被他人或他处修改，为避免覆盖你的改动未保存，请重载后再编辑')
        return
      }
      const patched = await updateGlobal<GlobalDoc>('site-settings', dirty)
      setBaseline((prev) => ({ ...prev, ...dirty }))
      loadedUpdatedAtRef.current =
        typeof patched?.updatedAt === 'string' ? patched.updatedAt : loadedUpdatedAtRef.current
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(describeApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings">
      <PageHeader title="站点设置" />

      <div className="settings__layout">
        <nav className="settings__menu" aria-label="配置分区">
          {/* 页面不滚，滚动只发生在卡内部；这层只管目录条目的等距竖排 */}
          <div className="settings__menu-inner">
            {SECTIONS.map((s) => (
              <button
                type="button"
                key={s.key}
                data-sec={s.key}
                className={`settings__menu-item${active === s.key ? ' settings__menu-item--active' : ''}`}
                onClick={() => {
                  goSection(s.key)
                  setError('')
                }}
              >
                <span className="settings__menu-icon" aria-hidden="true">
                  {s.icon}
                </span>
                <span className="settings__menu-text">
                  <span className="settings__menu-title">{s.title}</span>
                  <span className="settings__menu-desc">{s.desc}</span>
                </span>
                {active === s.key && <span className="settings__menu-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </nav>

        <section className="settings__panel">
          {active === null ? (
            // SSR/水合前：五个分区的标题、说明、输入框骨架全部就位，
            // 由 CSS :target 按 URL 哈希只显示对应分区（无哈希显示默认第一项），
            // 加载只发生在框内数据（此时为空）。水合完成后切换到受控的单分区渲染。
            <div className="settings__ssr">
              {SECTIONS.map((s, i) => (
                <div key={s.key} id={s.key} className={`settings__ssr-sec${i === 0 ? ' settings__ssr-sec--default' : ''}`}>
                  <h2 className="settings__panel-title">{s.title}</h2>
                  <fieldset className="settings__body" disabled>
                    <SectionBody sec={s} values={emptyValues()} onField={noopField} />
                  </fieldset>
                </div>
              ))}
            </div>
          ) : (
            <>
              <h2 className="settings__panel-title">{section.title}</h2>
              <fieldset className="settings__body" data-loading={loading || undefined} disabled={loading}>
                <SectionBody sec={section} values={values} onField={setValue} />
              </fieldset>
            </>
          )}

          {error && <p className="settings__error">{error}</p>}

          {loadFailed || conflict ? (
            <button
              type="button"
              className="settings__submit settings__submit--fit"
              onClick={() => void load()}
              disabled={loading}
            >
              重新加载
            </button>
          ) : (
            <button
              type="button"
              className="settings__submit settings__submit--fit"
              disabled={loading || busy || !hasDirty}
              onClick={() => void save()}
            >
              {busy ? '保存中…' : saved ? '已保存 ✓' : '保存'}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}

const noopField = () => {}

/** 分区字段主体：SSR 骨架（空值 + 外层 disabled）与水合后受控渲染共用同一套版式 */
function SectionBody({
  sec,
  values,
  onField,
}: {
  sec: SectionDef
  values: Values
  onField: (name: string, v: string) => void
}) {
  if (sec.key === 'socials') {
    return <SocialsEditor value={values.socials ?? ''} onChange={(v) => onField('socials', v)} />
  }
  return (
    <div className="settings__grid">
      {sec.fields.map((f) =>
        f.editor ? (
          <div className="settings__field settings__field--full" key={f.name}>
            {f.editor === 'notes' ? (
              <NotesEditor
                label={f.label}
                hint={f.hint}
                value={values[f.name] ?? ''}
                onChange={(v) => onField(f.name, v)}
              />
            ) : f.editor === 'skills' ? (
              <SkillsEditor
                label={f.label}
                hint={f.hint}
                value={values[f.name] ?? ''}
                onChange={(v) => onField(f.name, v)}
              />
            ) : (
              <FooterLineEditor
                label={f.label}
                hint={f.hint}
                value={values[f.name] ?? ''}
                onChange={(v) => onField(f.name, v)}
              />
            )}
          </div>
        ) : f.widget === 'uploader' ? (
          <div className="settings__field settings__field--full" key={f.name}>
            <span className="settings__field-label">{f.label}</span>
            {f.hint && <span className="settings__field-hint">{f.hint}</span>}
            <CoverUploader
              value={values[f.name] ?? ''}
              onChange={(v) => onField(f.name, v)}
              placeholder="请输入图标地址"
              className="cover-uploader--icon"
            />
          </div>
        ) : (
          <label
            key={f.name}
            className={`settings__field${f.span === 2 ? ' settings__field--full' : ''}${f.narrow ? ' settings__field--narrow' : ''}`}
          >
            <span className="settings__field-label">
              {f.label}
              {f.required && <i className="settings__field-req">*</i>}
            </span>
            {f.hint && <span className="settings__field-hint">{f.hint}</span>}
            {f.type === 'textarea' ? (
              <textarea
                value={values[f.name] ?? ''}
                onChange={(e) => onField(f.name, e.target.value)}
                placeholder={f.placeholder}
                rows={f.rows ?? 4}
              />
            ) : f.type === 'date' ? (
              <DateField value={values[f.name] ?? ''} onChange={(v) => onField(f.name, v)} />
            ) : (
              <input
                type="text"
                value={values[f.name] ?? ''}
                onChange={(e) => onField(f.name, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </label>
        ),
      )}
    </div>
  )
}

/** 社交链接面板：与 SocialLinksField 相同的行卡片交互，但值来自本视图 state */function SocialsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = parseSocials(value)

  const replace = (next: typeof items) => onChange(stringifySocials(next))

  return (
    <div className="social-links-field settings__socials">
      <div className="social-links-field__list">
        {items.length === 0 && (
          <div className="social-links-field__empty">还没有添加社交链接，点击下方按钮添加一条。</div>
        )}
        {items.map((item, index) => {
          const option =
            PLATFORM_OPTIONS.find((p) => p.value === item.platform) ?? PLATFORM_OPTIONS[0]
          return (
            <div className="social-links-field__row" key={`${item.platform}-${index}`}>
              <div className="social-links-field__platform">
                <span
                  className="social-links-field__dot"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
                <select
                  value={item.platform}
                  onChange={(e) =>
                    replace(
                      items.map((it, i) =>
                        i === index ? { ...it, platform: e.target.value as Platform } : it,
                      ),
                    )
                  }
                  className="social-links-field__select"
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={item.href}
                onChange={(e) =>
                  replace(items.map((it, i) => (i === index ? { ...it, href: e.target.value } : it)))
                }
                placeholder="https://..."
                className="social-links-field__input"
              />
              <button
                type="button"
                onClick={() => replace(items.filter((_, i) => i !== index))}
                className="social-links-field__remove"
                aria-label="删除此链接"
                title="删除"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => replace([...items, { platform: 'bilibili' as Platform, href: '' }])}
        className="social-links-field__add"
      >
        + 添加社交链接
      </button>
      <p className="social-links-field__hint">
        每行保存为「平台 链接」格式，前台会自动匹配对应图标。支持{' '}
        {PLATFORM_OPTIONS.map((p) => p.label).join(' / ')}；认不出图标的平台不会消失，前台按纯文字显示平台名。
      </p>
    </div>
  )
}

/** 颜色选择：5 个预设主题色点 + 原生取色器（任意颜色）。存 token 或 hex，空 = 前台默认色 */
function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isCustom = value.startsWith('#')
  return (
    <span className="about-color">
      {PRESET_COLORS.map((c) => (
        <button
          type="button"
          key={c.token}
          className={`about-color__dot${value === c.token ? ' about-color__dot--on' : ''}`}
          style={{ backgroundColor: c.swatch }}
          title={c.label}
          aria-label={c.label}
          onClick={() => onChange(c.token)}
        />
      ))}
      <label
        className={`about-color__dot about-color__dot--custom${isCustom ? ' about-color__dot--on' : ''}`}
        style={isCustom ? { backgroundColor: value } : undefined}
        title="自定义颜色"
      >
        <input type="color" value={isCustom ? value : '#ffdf8a'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </span>
  )
}

/** 行编辑器公共外壳：头部（字段名 + 「批量文本」切换胶囊）+ 列表 + 添加按钮；批量模式整块换成 textarea */
const DEFAULT_BATCH_PLACEHOLDER =
  '每行一条，用竖线分隔，颜色可省略：\n坐标广州|1995 年生|green\n吃素|偶尔|#c9e6a4'

function ListEditorShell({
  label,
  hint,
  batch,
  batchText,
  emptyText,
  addLabel,
  batchPlaceholder,
  onAdd,
  onToggleBatch,
  onBatchText,
  children,
}: {
  label: string
  hint?: string
  batch: boolean
  batchText: string
  emptyText: string
  addLabel: string
  batchPlaceholder?: string
  onAdd: () => void
  onToggleBatch: () => void
  onBatchText: (t: string) => void
  children: ReactNode
}) {
  const isEmpty = Array.isArray(children) && children.length === 0
  return (
    <div className="social-links-field about-list-field">
      <div className="about-list-field__head">
        <div className="about-list-field__titles">
          <span className="settings__field-label">{label}</span>
          {hint && <span className="settings__field-hint">{hint}</span>}
        </div>
        <button type="button" className="about-list-field__toggle" onClick={onToggleBatch}>
          {batch ? '逐条编辑' : '批量文本'}
        </button>
      </div>
      {batch ? (
        <textarea
          className="about-list-field__batch"
          value={batchText}
          rows={6}
          placeholder={batchPlaceholder ?? DEFAULT_BATCH_PLACEHOLDER}
          onChange={(e) => onBatchText(e.target.value)}
        />
      ) : (
        <>
          <div className="social-links-field__list">
            {isEmpty ? <div className="social-links-field__empty">{emptyText}</div> : children}
          </div>
          <button type="button" className="social-links-field__add" onClick={onAdd}>
            {addLabel}
          </button>
        </>
      )}
    </div>
  )
}

/** 便签行编辑器：每行「标题 + 副文字 + 颜色点」，可切批量文本模式 */
function NotesEditor({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  const items = useMemo(() => parseNotes(value), [value])
  const [batch, setBatch] = useState(false)
  const [batchText, setBatchText] = useState('')

  const replace = (next: NoteItem[]) => onChange(stringifyNotes(next))
  const update = (index: number, patch: Partial<NoteItem>) =>
    replace(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))

  const toggleBatch = () => {
    if (!batch) setBatchText(notesToBatch(items))
    else onChange(stringifyNotes(notesFromBatch(batchText, items)))
    setBatch(!batch)
  }

  return (
    <ListEditorShell
      label={label}
      hint={hint}
      batch={batch}
      batchText={batchText}
      onBatchText={(t) => {
        setBatchText(t)
        onChange(stringifyNotes(notesFromBatch(t, items)))
      }}
      emptyText="还没有便签，点击下方按钮添加一条。"
      addLabel="+ 添加便签"
      onAdd={() => replace([...items, { title: '', subtitle: '', color: '' }])}
      onToggleBatch={toggleBatch}
    >
      {items.map((it, index) => (
        <div className="social-links-field__row about-row" key={index}>
          <span className="about-row__cell about-row__cell--grow">
            <i className="about-row__cap">标题</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.title}
              onChange={(e) => update(index, { title: e.target.value })}
            />
          </span>
          <span className="about-row__cell about-row__cell--grow">
            <i className="about-row__cap">副文字</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.subtitle}
              onChange={(e) => update(index, { subtitle: e.target.value })}
            />
          </span>
          <span className="about-row__cell about-row__cell--end">
            <ColorPicker value={it.color} onChange={(c) => update(index, { color: c })} />
          </span>
          <button
            type="button"
            className="social-links-field__remove about-row__remove"
            aria-label="删除此便签"
            title="删除"
            onClick={() => replace(items.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
    </ListEditorShell>
  )
}

/** 技能环行编辑器：每行「名称 + 副标题 + 数值 + 颜色点」，可切批量文本模式 */
function SkillsEditor({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  const items = useMemo(() => parseSkills(value), [value])
  const [batch, setBatch] = useState(false)
  const [batchText, setBatchText] = useState('')

  const replace = (next: SkillItem[]) => onChange(stringifySkills(next))
  const update = (index: number, patch: Partial<SkillItem>) =>
    replace(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))

  const toggleBatch = () => {
    if (!batch) setBatchText(skillsToBatch(items))
    else onChange(stringifySkills(skillsFromBatch(batchText, items)))
    setBatch(!batch)
  }

  return (
    <ListEditorShell
      label={label}
      hint={hint}
      batch={batch}
      batchText={batchText}
      onBatchText={(t) => {
        setBatchText(t)
        onChange(stringifySkills(skillsFromBatch(t, items)))
      }}
      emptyText="还没有技能，点击下方按钮添加一条。"
      addLabel="+ 添加技能"
      onAdd={() => replace([...items, { label: '', sublabel: '', value: 80, color: '' }])}
      onToggleBatch={toggleBatch}
    >
      {items.map((it, index) => (
        <div className="social-links-field__row about-row" key={index}>
          <span className="about-row__cell about-row__cell--grow">
            <i className="about-row__cap">名称</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
          </span>
          <span className="about-row__cell about-row__cell--grow">
            <i className="about-row__cap">副标题</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.sublabel}
              onChange={(e) => update(index, { sublabel: e.target.value })}
            />
          </span>
          <span className="about-row__cell about-row__cell--num">
            <i className="about-row__cap">数值</i>
            <input
              type="number"
              className="social-links-field__input about-row__num"
              value={it.value}
              min={0}
              max={100}
              aria-label="数值 0-100"
              onChange={(e) => update(index, { value: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
            />
          </span>
          <span className="about-row__cell about-row__cell--end">
            <ColorPicker value={it.color} onChange={(c) => update(index, { color: c })} />
          </span>
          <button
            type="button"
            className="social-links-field__remove about-row__remove"
            aria-label="删除此技能"
            title="删除"
            onClick={() => replace(items.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
    </ListEditorShell>
  )
}

/** 页脚一行：名称可含空格（前台按最后一个空格切分），链接可留空 */
interface FooterLine {
  name: string
  href: string
}

/**
 * 页脚文本 → 行数组。切分规则与前台 parseFooterLines 一致（最后一个空格），
 * 空行直接忽略：新加的空行由组件本地 state 持有，不靠文本里的空行占位。
 */
function parseFooterLines(raw: string): FooterLine[] {
  const out: FooterLine[] = []
  for (const line of String(raw ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.lastIndexOf(' ')
    if (sp === -1) out.push({ name: trimmed, href: '' })
    else out.push({ name: trimmed.slice(0, sp).trim(), href: trimmed.slice(sp + 1).trim() })
  }
  return out
}

/** 行数组 → 页脚文本：名称与链接都空的行写成空行，前台解析会跳过 */
function stringifyFooterLines(items: FooterLine[]): string {
  return items
    .map((it) => [it.name.trim(), it.href.trim()].filter(Boolean).join(' '))
    .join('\n')
}

/** 页脚行编辑器：每行「名称 + 链接」，可切批量文本模式（批量文本就是存储格式本身） */
function FooterLineEditor({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  // 行内容以本地 state 为准：文本格式对「名称里正在输入的空格」是有损的
  // （"QQ " 存成 "QQ"），若每帧从 value 反解，「QQ 交流群」这种带空格的名永远打不出来。
  const [rows, setRows] = useState(() => parseFooterLines(value))
  const [batch, setBatch] = useState(false)
  const emittedRef = useRef<string | null>(null)

  // value 被外部改写（首次载入、批量文本）才重新反解；自己刚写回的那次跳过
  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setRows(parseFooterLines(value))
  }, [value])

  const commit = (next: FooterLine[]) => {
    const text = stringifyFooterLines(next)
    emittedRef.current = text
    setRows(next)
    onChange(text)
  }
  const update = (index: number, patch: Partial<FooterLine>) =>
    commit(rows.map((it, i) => (i === index ? { ...it, ...patch } : it)))

  return (
    <ListEditorShell
      label={label}
      hint={hint}
      batch={batch}
      batchText={value}
      onBatchText={onChange}
      emptyText="还没有条目，点击下方按钮添加一条。"
      addLabel="+ 添加一条"
      batchPlaceholder={'每行一条「名称 链接」：\nBilibili https://space.bilibili.com/1459419286\nRSS /rss.xml'}
      onAdd={() => commit([...rows, { name: '', href: '' }])}
      onToggleBatch={() => setBatch(!batch)}
    >
      {rows.map((it, index) => (
        <div className="social-links-field__row about-row" key={index}>
          <span className="about-row__cell about-row__cell--grow">
            <i className="about-row__cap">名称</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.name}
              placeholder="Bilibili"
              onChange={(e) => update(index, { name: e.target.value })}
            />
          </span>
          <span className="about-row__cell about-row__cell--url">
            <i className="about-row__cap">链接</i>
            <input
              type="text"
              className="social-links-field__input"
              value={it.href}
              placeholder="https://... 或 /rss.xml"
              onChange={(e) => update(index, { href: e.target.value })}
            />
          </span>
          <button
            type="button"
            className="social-links-field__remove about-row__remove"
            aria-label="删除此条"
            title="删除"
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
    </ListEditorShell>
  )
}

/* ---------- 自定义日期选择器：见 components/DateField.tsx（与评论管理页共用） ---------- */

export default SettingsEditView