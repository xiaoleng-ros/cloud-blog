'use client'

/**
 * AI 平台配置弹窗：选平台 → 填 Key → 拉取该账号可用模型 → 单选/多选 → 确认。
 * createPortal 挂 body；Esc / 点遮罩关闭；打开时锁背景滚动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ShellIcon } from '../../shell/icons'

export interface AiPresetOption {
  id: string
  name: string
  short: string
  color: string
  keyUrl: string
  baseURL: string
}
export interface AiDialogValue {
  platformId: string
  apiKey: string
  modelIds: string[]
  /** 编辑时后端已有保存的 Key（前端仅拿到脱敏串，明文仍留在服务端） */
  hasSavedKey?: boolean
}

/** 平台官方 logo 文件（放在 public/ai-logos/，直接从各平台官网下载的原图） */
const PLATFORM_LOGO: Record<string, string> = {
  siliconflow: '/ai-logos/siliconflow.svg',
  zhipu: '/ai-logos/zhipu.png',
  deepseek: '/ai-logos/deepseek.png',
  moonshot: '/ai-logos/kimi.png',
}

/** 平台官方 logo 图标：直接使用官网下载的原始 logo 文件 */
export function PlatformIcon({ id, size = 18 }: { id: string; size?: number }) {
  const src = PLATFORM_LOGO[id]
  if (!src) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block' }}
      draggable={false}
    />
  )
}

interface Props {
  open: boolean
  presets: AiPresetOption[]
  initial: AiDialogValue | null
  onClose: () => void
  onConfirm: (value: AiDialogValue) => void
}

type RemoteModel = {
  id: string
  name: string
  /** 官方定价页明确免费 */
  free: boolean
  /** 输入单价（元/百万 Tokens） */
  inputPrice?: number
  /** 输出单价（元/百万 Tokens） */
  outputPrice?: number
  /** 上下文长度 */
  context?: string
  note?: string
  /** 来源：remote=平台返回，preset=本地预设补充 */
  source: 'remote' | 'preset'
  /** 可用性探测：ok=实测可调用，unknown=未探测（非对话模型或探测无法判断） */
  verified?: 'ok' | 'unknown'
}

type ModelFilter = 'all' | 'free' | 'paid'

export function AiPlatformDialog({ open, presets, initial, onClose, onConfirm }: Props) {
  const [platformId, setPlatformId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasSavedKey, setHasSavedKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<RemoteModel[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ModelFilter>('all')
  const keyRef = useRef<HTMLInputElement>(null)
  const preset = presets.find((p) => p.id === platformId)

  useEffect(() => {
    if (!open) return
    const pid = initial?.platformId || presets[0]?.id || ''
    setPlatformId(pid)
    setApiKey(initial?.apiKey || '')
    setHasSavedKey(Boolean(initial?.hasSavedKey))
    setShowKey(Boolean(initial?.apiKey))
    setSelected(initial?.modelIds ?? [])
    setModels((initial?.modelIds ?? []).map((id) => ({ id, name: id, free: false, source: 'preset' as const })))
    setFetched(Boolean(initial?.modelIds?.length))
    setError('')
    setFilter('all')
    const timer = window.setTimeout(() => keyRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, initial, presets])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const changePlatform = (id: string) => {
    setPlatformId(id)
    setApiKey('')
    setHasSavedKey(false)
    setShowKey(false)
    setModels([])
    setSelected([])
    setFetched(false)
    setError('')
    setFilter('all')
  }

  const fetchModels = useCallback(async () => {
    if (!platformId) {
      setError('请选择平台')
      return
    }
    if (!apiKey.trim() && !hasSavedKey) {
      setError('请先填写 API Key')
      return
    }
    setLoading(true)
    setError('')
    setFetched(false)
    try {
      const res = await fetch('/api/admin/ai-models/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformId, apiKey: apiKey.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || '拉取失败')
      const list = (data as { models: RemoteModel[] }).models || []
      setModels(list)
      // 保留在新列表中仍然存在的已选模型：用户在原基础上追加勾选时，
      // 重新拉取不会把之前选好的模型清空。
      const validIds = new Set(list.map((m) => m.id))
      setSelected((prev) => prev.filter((id) => validIds.has(id)))
      setFetched(true)
      if (!list.length) setError('该账号没有返回可用模型，请检查 Key 是否正确')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [platformId, apiKey])

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const confirm = () => {
    if (!apiKey.trim() && !hasSavedKey) {
      setError('请填写 API Key')
      return
    }
    if (!selected.length) {
      setError('请至少选择一个模型（可多选）')
      return
    }
    onConfirm({ platformId, apiKey: apiKey.trim(), modelIds: selected, hasSavedKey })
  }

  if (!open) return null

  return createPortal(
    <>
      <style>{DIALOG_CSS}</style>
      <div
        className="aid-mask"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="aid" role="dialog" aria-modal="true" aria-labelledby="aid-title">
          <header className="aid__head">
            <div className="aid__head-left">
              <div className="aid__head-icon" aria-hidden="true">
                <ShellIcon name="ai" size={18} />
              </div>
              <div>
                <h2 className="aid__title" id="aid-title">
                  {initial ? '编辑平台' : '添加平台'}
                </h2>
                <p className="aid__sub">选平台、填 Key，拉取该账号可用的模型后选择（可多选）。</p>
              </div>
            </div>
            <button className="aid__x" aria-label="关闭" onClick={onClose}>
              <ShellIcon name="close" size={18} />
            </button>
          </header>
          <div className="aid__body">
            {/* 平台选择：卡片式 */}
            <div className="aid__field">
              <label className="aid__label">平台</label>
              <div className="aid__platforms">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`aid__platform${p.id === platformId ? ' aid__platform--active' : ''}`}
                    onClick={() => changePlatform(p.id)}
                    style={{ ['--brand' as string]: p.color }}
                  >
                    <span className="aid__platform-badge">
                      <PlatformIcon id={p.id} size={18} />
                    </span>
                    <span className="aid__platform-name">{p.name}</span>
                    {p.id === platformId && (
                      <svg
                        className="aid__platform-check"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="aid__field">
              <label className="aid__label" htmlFor="aid-key">
                API Key{' '}
                {preset?.keyUrl && (
                  <a className="aid__link" href={preset.keyUrl} target="_blank" rel="noreferrer">
                    去获取 ↗
                  </a>
                )}
              </label>
              <div className="aid__row">
                <div className="aid__key-wrap">
                  <input
                    id="aid-key"
                    ref={keyRef}
                    className="aid__input"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={hasSavedKey ? '已保存的 Key · 可直接修改' : '粘贴 API Key'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="aid__eye"
                    title={showKey ? '隐藏 Key' : '显示 Key'}
                    aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <button className="aid__fetch" onClick={fetchModels} disabled={loading}>
                  {loading ? (
                    <>
                      <svg
                        className="ai-spin"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      拉取中…
                    </>
                  ) : fetched ? (
                    '重新拉取'
                  ) : (
                    '拉取模型'
                  )}
                </button>
              </div>
            </div>

            <div className="aid__models">
              <div className="aid__models-head">
                <span className="aid__label">可用模型（可多选）</span>
                <span className="aid__hint">
                  {fetched ? `已选 ${selected.length} / ${models.length}` : '填 Key 后点「拉取模型」'}
                </span>
              </div>
              {fetched && models.length > 0 && (
                <div className="aid__filters">
                  {(
                    [
                      { key: 'all', label: '全部', count: models.length },
                      { key: 'free', label: '免费', count: models.filter((m) => m.free).length },
                      { key: 'paid', label: '收费', count: models.filter((m) => !m.free).length },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={`aid__filter${filter === f.key ? ' aid__filter--active' : ''}${f.key === 'free' ? ' aid__filter--free' : ''}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                      <span className="aid__filter-count">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {!fetched ? (
                <div className="aid__state">
                  <div className="aid__state-icon">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p>填入 API Key 并点「拉取模型」，即可看到该账号实际可用的模型。</p>
                </div>
              ) : models.length === 0 ? (
                <div className="aid__state">
                  <p>没有返回模型</p>
                </div>
              ) : (
                (() => {
                  const list = models.filter((m) => (filter === 'all' ? true : filter === 'free' ? m.free : !m.free))
                  if (!list.length) {
                    return (
                      <div className="aid__state">
                        <p>该分组下没有模型</p>
                      </div>
                    )
                  }
                  return (
                    <div className="aid__list">
                      {list.map((m) => {
                        const checked = selected.includes(m.id)
                        return (
                          <button
                            type="button"
                            key={m.id}
                            className={`aid__opt${checked ? ' aid__opt--checked' : ''}`}
                            onClick={() => toggle(m.id)}
                          >
                            <span className={`aid__opt-box${checked ? ' aid__opt-box--checked' : ''}`}>
                              {checked && (
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              )}
                            </span>
                            <span className="aid__opt-main">
                              <span className="aid__opt-name">
                                {m.name}
                                {m.verified === 'ok' && (
                                  <span className="aid__verified" title="已实测可正常调用">
                                    <svg
                                      width="11"
                                      height="11"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                  </span>
                                )}
                              </span>
                              <span className="aid__opt-meta">
                                <span className="aid__opt-id" title={m.id}>
                                  {m.id}
                                </span>
                                {m.context && <span className="aid__opt-ctx">{m.context}</span>}
                                {m.source === 'preset' && (
                                  <span
                                    className="aid__opt-src"
                                    title="平台 /models 未返回，来自本地预设补充（可能已下线，建议实测）"
                                  >
                                    预设
                                  </span>
                                )}
                              </span>
                            </span>
                            {m.free ? (
                              <span className="aid__tag aid__tag--free" title="官方定价页明确：输入与输出均免费">
                                免费
                              </span>
                            ) : m.inputPrice != null && m.outputPrice != null ? (
                              <span
                                className="aid__tag aid__tag--paid"
                                title={`收费模型：输入 ${m.inputPrice} / 输出 ${m.outputPrice} 元每百万 Tokens`}
                              >
                                ¥{m.inputPrice}/{m.outputPrice}
                              </span>
                            ) : (
                              <span className="aid__tag aid__tag--unknown" title="该模型未收录价格，按官方实际计费为准">
                                按量
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })()
              )}
            </div>
            {error && (
              <div className="aid__error">
                <ShellIcon name="close" size={14} /> {error}
              </div>
            )}
          </div>
          <footer className="aid__foot">
            <span className="aid__count">
              共选择 <b>{selected.length}</b> 个模型
            </span>
            <div className="aid__actions">
              <button className="aid__btn" onClick={onClose}>
                取消
              </button>
              <button className="aid__btn aid__btn--primary" onClick={confirm} disabled={loading}>
                确认使用
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  )
}

/** 弹窗样式：aid- 前缀区分，全部走后台主题变量 */
const DIALOG_CSS = `
/* AI 平台配置弹窗 · 走后台主题变量 */
.aid-mask{position:fixed;inset:0;z-index:100000;background:rgb(20 27 38 / .5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:1rem}
.aid{width:min(600px,100%);max-height:90vh;overflow:auto;background:var(--theme-elevation-0);border:1px solid var(--theme-elevation-200);border-radius:16px;box-shadow:var(--shadow-popup);animation:aid-in 180ms cubic-bezier(.16,1,.3,1);display:flex;flex-direction:column}
@keyframes aid-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.aid__head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.25rem 1.4rem;border-bottom:1px solid var(--theme-elevation-150);flex-shrink:0}
.aid__head-left{display:flex;align-items:center;gap:.85rem}
.aid__head-icon{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--accent-hover));color:#fff;flex-shrink:0;box-shadow:0 4px 10px -2px rgb(79 147 245 / .4)}
.aid__title{font-size:1.1rem;font-weight:700;margin:0;color:var(--theme-elevation-900)}
html[data-theme='dark'] .aid__title{color:var(--theme-elevation-100)}
.aid__sub{font-size:.8rem;color:var(--theme-elevation-500);margin:.2rem 0 0;line-height:1.5}
.aid__x{border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.35rem;border-radius:8px;display:flex;transition:all 140ms ease}
.aid__x:hover{background:var(--danger-soft);color:var(--danger)}
.aid__x:focus-visible{outline:none;box-shadow:var(--ring)}
.aid__body{padding:1.3rem 1.4rem;display:flex;flex-direction:column;gap:1.1rem;flex:1;overflow:auto}
.aid__field{display:flex;flex-direction:column;gap:.5rem}
.aid__label{font-size:.8rem;font-weight:650;color:var(--theme-elevation-700)}
html[data-theme='dark'] .aid__label{color:var(--theme-elevation-300)}

/* 平台卡片选择 */
.aid__platforms{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.55rem}
.aid__platform{display:flex;align-items:center;gap:.55rem;padding:.65rem .75rem;border:1.5px solid var(--theme-elevation-200);border-radius:11px;background:var(--theme-elevation-0);cursor:pointer;transition:all 160ms cubic-bezier(.16,1,.3,1);text-align:left;position:relative;overflow:hidden}
.aid__platform::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--brand,var(--accent)),transparent);opacity:0;transition:opacity 160ms ease}
.aid__platform:hover{border-color:var(--theme-elevation-300);background:var(--theme-elevation-50);transform:translateY(-1px)}
.aid__platform:hover::before{opacity:.06}
.aid__platform--active{border-color:var(--brand,var(--accent));background:var(--accent-soft);box-shadow:0 4px 14px -4px rgb(79 147 245 / .25),0 0 0 3px rgb(79 147 245 / .1)}
.aid__platform--active::before{opacity:.08}
.aid__platform-badge{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;position:relative;z-index:1}
.aid__platform-badge img,.aid__platform-badge svg{width:100%;height:100%;object-fit:contain;display:block}
.aid__platform-name{font-size:.82rem;font-weight:600;color:var(--theme-elevation-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html[data-theme='dark'] .aid__platform-name{color:var(--theme-elevation-200)}
.aid__platform-check{margin-left:auto;color:var(--accent-text);flex-shrink:0}

.aid__row{display:flex;gap:.6rem;align-items:flex-end}
.aid__row>*:first-child{flex:1}
.aid__key-wrap{position:relative;flex:1;min-width:0}
.aid__key-wrap .aid__input{padding-right:2.6rem}
.aid__input{width:100%;box-sizing:border-box;border:1px solid var(--theme-elevation-250);border-radius:9px;padding:.6rem .75rem;font-size:.85rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit;transition:border-color 140ms ease,box-shadow 140ms ease}
.aid__input:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.aid__eye{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.35rem;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background 140ms ease,color 140ms ease}
.aid__eye:hover{background:var(--accent-soft);color:var(--accent-text)}
.aid__eye:focus-visible{outline:none;box-shadow:var(--ring)}
.aid__link{font-size:.75rem;color:var(--accent-text);text-decoration:none;font-weight:500}
.aid__link:hover{text-decoration:underline}
.aid__fetch{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent-text);border-radius:9px;padding:.6rem .9rem;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all 140ms ease}
.aid__fetch:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.aid__fetch:disabled{opacity:.55;cursor:not-allowed}
.aid__fetch:focus-visible{outline:none;box-shadow:var(--ring)}
.ai-spin{animation:ai-spin .8s linear infinite}
@keyframes ai-spin{to{transform:rotate(360deg)}}

/* 模型列表 */
.aid__models{margin-top:.1rem}
.aid__models-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem}
.aid__hint{font-size:.75rem;color:var(--theme-elevation-500)}

/* 免费/收费筛选 */
.aid__filters{display:flex;gap:.4rem;margin-bottom:.6rem}
.aid__filter{display:inline-flex;align-items:center;gap:.35rem;border:1px solid var(--theme-elevation-200);background:var(--theme-elevation-0);color:var(--theme-elevation-600);font-size:.76rem;font-weight:600;padding:.32rem .6rem;border-radius:8px;cursor:pointer;font-family:inherit;transition:all 140ms ease}
html[data-theme='dark'] .aid__filter{color:var(--theme-elevation-300)}
.aid__filter:hover{border-color:var(--theme-elevation-300);background:var(--theme-elevation-50)}
.aid__filter--active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text)}
.aid__filter--free.aid__filter--active{border-color:#12a150;background:#e6f7ee;color:#0a7a44}
html[data-theme='dark'] .aid__filter--free.aid__filter--active{background:#123328;color:#5fd39a;border-color:#1d6b48}
.aid__filter-count{font-size:.7rem;opacity:.75;background:var(--theme-elevation-150);padding:.02rem .3rem;border-radius:5px;min-width:1.1rem;text-align:center}
.aid__filter--active .aid__filter-count{background:rgb(79 147 245 / .18)}
.aid__filter--free.aid__filter--active .aid__filter-count{background:rgb(18 161 80 / .18)}
.aid__list{border:1px solid var(--theme-elevation-200);border-radius:11px;max-height:260px;overflow:auto;background:var(--theme-elevation-50);padding:.35rem}
.aid__opt{display:flex;align-items:center;gap:.65rem;padding:.6rem .65rem;border-radius:9px;cursor:pointer;border:none;background:transparent;text-align:left;width:100%;transition:all 140ms ease}
.aid__opt:hover{background:var(--theme-elevation-100)}
.aid__opt--checked{background:var(--accent-soft)}
.aid__opt--checked:hover{background:var(--accent-soft)}
.aid__opt-box{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--theme-elevation-300);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--theme-elevation-0);transition:all 140ms ease}
.aid__opt-box--checked{background:var(--accent);border-color:var(--accent);color:#fff}
.aid__opt-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:.1rem}
.aid__opt-name{font-size:.84rem;font-weight:500;color:var(--theme-elevation-800);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html[data-theme='dark'] .aid__opt-name{color:var(--theme-elevation-200)}
.aid__opt-meta{display:flex;align-items:center;gap:.4rem;min-width:0}
.aid__opt-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.71rem;color:var(--theme-elevation-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aid__opt-ctx{font-size:.68rem;color:var(--theme-elevation-500);background:var(--theme-elevation-100);padding:.02rem .35rem;border-radius:5px;flex-shrink:0}
.aid__verified{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#12a150;color:#fff;margin-left:.4rem;vertical-align:middle;flex-shrink:0}
html[data-theme='dark'] .aid__verified{background:#1d9c5c}
.aid__opt-src{font-size:.66rem;color:var(--theme-elevation-500);border:1px solid var(--theme-elevation-250);padding:.02rem .3rem;border-radius:5px;flex-shrink:0}

/* 免费/收费标签 */
.aid__tag{flex-shrink:0;font-size:.7rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.aid__tag--free{background:#e6f7ee;color:#0a7a44}
html[data-theme='dark'] .aid__tag--free{background:#123328;color:#5fd39a}
.aid__tag--paid{background:var(--theme-elevation-100);color:var(--theme-elevation-600)}
html[data-theme='dark'] .aid__tag--paid{color:var(--theme-elevation-300)}
.aid__tag--unknown{background:var(--theme-elevation-100);color:var(--theme-elevation-500);font-weight:600}
.aid__state{padding:1.6rem 1rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.5rem;border:1px dashed var(--theme-elevation-200);border-radius:11px;background:var(--theme-elevation-50)}
.aid__state-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--theme-elevation-100);color:var(--theme-elevation-400);margin-bottom:.2rem}
.aid__state p{font-size:.83rem;color:var(--theme-elevation-500);margin:0;line-height:1.5;max-width:320px}
.aid__error{display:flex;align-items:center;gap:.5rem;padding:.7rem .85rem;border-radius:10px;background:var(--danger-soft);color:var(--danger);font-size:.8rem;line-height:1.5}
.aid__foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.4rem;border-top:1px solid var(--theme-elevation-150);background:var(--theme-elevation-50);border-radius:0 0 16px 16px;flex-shrink:0}
.aid__count{font-size:.8rem;color:var(--theme-elevation-500)}
.aid__count b{color:var(--accent-text);font-weight:700}
html[data-theme='dark'] .aid__count b{color:var(--accent)}
.aid__actions{display:flex;gap:.6rem}
.aid__btn{border:1px solid var(--theme-elevation-250);background:var(--theme-elevation-0);color:var(--theme-text);border-radius:9px;padding:.55rem 1.1rem;font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 140ms ease}
.aid__btn:hover{border-color:var(--accent);color:var(--accent-text);background:var(--accent-soft)}
.aid__btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.aid__btn--primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
.aid__btn:disabled{opacity:.5;cursor:not-allowed}
.aid__btn:focus-visible{outline:none;box-shadow:var(--ring)}
@media(prefers-reduced-motion:reduce){.aid{animation:none}.aid__platform,.aid__opt,.aid__opt-box,.aid__btn,.aid__fetch,.aid__x{transition:none}}
`
