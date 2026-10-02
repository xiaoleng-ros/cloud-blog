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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '../../components/PageHeader'
import {
  parseSocials,
  PLATFORM_OPTIONS,
  stringifySocials,
  type Platform,
} from '../../components/SocialLinksField'
import { describeApiError, fetchGlobal, updateGlobal } from '../lib/api'

/** 字段定义：text 单行、textarea 多行；span=2 占满整行 */
interface FieldDef {
  name: string
  label: string
  type: 'text' | 'textarea'
  required?: boolean
  placeholder?: string
  hint?: string
  rows?: number
  span?: 1 | 2
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
      { name: 'twikooEnvId', label: 'Twikoo 评论服务地址', type: 'text' },
      { name: 'neteasePlaylistId', label: '网易云歌单 ID', type: 'text' },
      { name: 'siteDescription', label: '站点简介', type: 'textarea', span: 2, rows: 3 },
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
        span: 2,
        rows: 5,
        hint: '每行一条「名称 链接」。支持 Bilibili / YouTube / RSS 图标，其余名称按文字展示。链接以 http 开头用新标签打开。',
      },
      {
        name: 'footerGroups',
        label: '页脚群组',
        type: 'textarea',
        span: 2,
        rows: 4,
        hint: '每行一条「名称 链接」，链接可留空仅填名称（展示为纯文字标签）。支持 QQ / 微信图标。',
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
      { name: 'aboutLead', label: '关于页大标题', type: 'text', span: 2 },
      {
        name: 'aboutParagraphs',
        label: '关于页正文',
        type: 'textarea',
        span: 2,
        rows: 6,
        hint: '每个段落一行。可使用简单 HTML，如 <span class="marker-highlight">高亮</span> 来给部分文字加高亮标记。',
      },
      {
        name: 'aboutNotes',
        label: '关于页便签',
        type: 'textarea',
        span: 2,
        rows: 4,
        hint: '每行一条「标题｜副文字｜颜色」，颜色可选 yellow / cyan / pink。',
      },
      {
        name: 'skills',
        label: '技能环',
        type: 'textarea',
        span: 2,
        rows: 6,
        hint: '每行一条「名称｜副标题｜数值｜颜色」，数值 0-100，颜色可选 yellow / cyan / pink / purple。',
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
    next[name] = typeof v === 'string' ? v : ''
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
  const [active, setActive] = useState(SECTIONS[0].key)
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
      setActive('site')
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
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.key}
              className={`settings__menu-item${active === s.key ? ' settings__menu-item--active' : ''}`}
              onClick={() => {
                setActive(s.key)
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
        </nav>

        <section className="settings__panel">
          <h2 className="settings__panel-title">{section.title}</h2>

          {loading ? (
            <p className="drafts__empty">加载中…</p>
          ) : section.key === 'socials' ? (
            <SocialsEditor value={values.socials ?? ''} onChange={(v) => setValue('socials', v)} />
          ) : (
            <div className="settings__grid">
              {section.fields.map((f) => (
                <label
                  key={f.name}
                  className={`settings__field${f.span === 2 ? ' settings__field--full' : ''}`}
                >
                  <span className="settings__field-label">
                    {f.label}
                    {f.required && <i className="settings__field-req">*</i>}
                  </span>
                  {f.type === 'textarea' ? (
                    <textarea
                      value={values[f.name] ?? ''}
                      onChange={(e) => setValue(f.name, e.target.value)}
                      placeholder={f.placeholder}
                      rows={f.rows ?? 4}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[f.name] ?? ''}
                      onChange={(e) => setValue(f.name, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  )}
                  {f.hint && <span className="settings__field-hint">{f.hint}</span>}
                </label>
              ))}
            </div>
          )}

          {error && <p className="settings__error">{error}</p>}

          {loadFailed || conflict ? (
            <button
              type="button"
              className="settings__submit"
              onClick={() => void load()}
              disabled={loading}
            >
              重新加载
            </button>
          ) : (
            <button
              type="button"
              className="settings__submit"
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

/** 社交链接面板：与 SocialLinksField 相同的行卡片交互，但值来自本视图 state */
function SocialsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
        {PLATFORM_OPTIONS.map((p) => p.label).join(' / ')}。
      </p>
    </div>
  )
}

export default SettingsEditView
