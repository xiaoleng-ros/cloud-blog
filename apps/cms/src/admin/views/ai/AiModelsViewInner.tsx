'use client'

/**
 * AI 模型管理主页：各区块卡片包裹；平台配置走弹窗拉取模型；已选模型可切换当前使用模型。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast, Toast } from '../../components/Toast'
import { ShellIcon } from '../../shell/icons'
import { AiPlatformDialog, PlatformIcon, type AiDialogValue, type AiPresetOption } from './AiPlatformDialog'

type Preset = AiPresetOption & { keyUrl: string; docs: string; models: unknown[]; defaultModel: string }
type Provider = {
  index: number
  platformId: string
  platformName: string
  short: string
  color: string
  baseURL: string
  keyUrl: string
  docs: string
  apiKeyMasked: string
  /** 管理员接口返回的明文 Key（仅后台可见），用于编辑弹窗展示 */
  apiKey?: string
  modelIds: string[]
  currentModelId: string
  enabled: boolean
  allowFrontend: boolean
}
type TestResult = { content: string; model: string; usage?: unknown; latencyMs?: number } | null

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || '请求失败')
  return data as T
}

/** 精致的空状态插画：悬浮的 AI 核心 + 轨道卫星 */
function EmptyIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ai-core-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f93f5" />
          <stop offset="100%" stopColor="#6aa8ff" />
        </linearGradient>
        <radialGradient id="ai-core-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#4f93f5" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#4f93f5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="50" fill="url(#ai-core-glow)" />
      <ellipse
        cx="60"
        cy="60"
        rx="48"
        ry="18"
        stroke="#4f93f5"
        strokeOpacity="0.2"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <ellipse
        cx="60"
        cy="60"
        rx="48"
        ry="18"
        stroke="#4f93f5"
        strokeOpacity="0.15"
        strokeWidth="1.5"
        transform="rotate(60 60 60)"
        strokeDasharray="4 4"
      />
      <ellipse
        cx="60"
        cy="60"
        rx="48"
        ry="18"
        stroke="#4f93f5"
        strokeOpacity="0.1"
        strokeWidth="1.5"
        transform="rotate(120 60 60)"
        strokeDasharray="4 4"
      />
      <circle cx="60" cy="60" r="22" fill="url(#ai-core-grad)" />
      <path d="M60 44l3.2 8.8L72 56l-8.8 3.2L60 68l-3.2-8.8L48 56l8.8-3.2L60 44z" fill="white" fillOpacity="0.9" />
      <circle cx="108" cy="60" r="3.5" fill="#4f93f5" />
      <circle cx="36" cy="30" r="3" fill="#4f93f5" fillOpacity="0.6" />
      <circle cx="36" cy="90" r="2.5" fill="#4f93f5" fillOpacity="0.4" />
    </svg>
  )
}

/** 统计数字小图标 */
function StatIcon({ type }: { type: 'platform' | 'model' | 'active' }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (type === 'platform')
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M9 3v18M3 9h6" />
      </svg>
    )
  if (type === 'model')
    return (
      <svg {...common}>
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  )
}

export function AiModelsViewInner() {
  const { toast, show } = useToast()
  const [presets, setPresets] = useState<Preset[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [testPlatform, setTestPlatform] = useState('')
  const [testModel, setTestModel] = useState('')
  const [testPrompt, setTestPrompt] = useState('你好，请简单介绍一下你自己。')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>(null)
  const [testError, setTestError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ providers: Provider[]; presets: Preset[] }>('/api/admin/ai-models')
      setPresets(data.presets)
      setProviders(data.providers)
      setTestPlatform(data.providers[0]?.platformId || '')
    } catch (e) {
      show('error', '加载失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [show])
  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const p = providers.find((x) => x.platformId === testPlatform)
    setTestModel(p?.currentModelId || p?.modelIds?.[0] || '')
  }, [testPlatform, providers])

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (i: number) => {
    setEditing(i)
    setDialogOpen(true)
  }

  const dialogInitial = (): AiDialogValue | null => {
    if (editing == null) return null
    const p = providers[editing]
    if (!p) return null
    return {
      platformId: p.platformId,
      apiKey: p.apiKey || '',
      modelIds: p.modelIds,
      hasSavedKey: Boolean(p.apiKey || p.apiKeyMasked),
    }
  }

  // 自动保存：任何配置变更都立即把最新数组写入后端，成功后回填脱敏 Key / 规范化模型。
  // saveSeq 用于丢弃过期响应（快速连续操作时只以最后一次为准）。
  const saveSeq = useRef(0)
  const autoSave = async (next: Provider[]) => {
    const seq = ++saveSeq.current
    setSaving(true)
    try {
      // 后端 PUT 认 apiKey 字段：把本地保存的 apiKeyMasked 映射过去。
      // 若它是脱敏值（含 •），后端会沿用数据库里已有的 Key。
      const payload = next.map((p) => ({
        platformId: p.platformId,
        apiKey: p.apiKeyMasked,
        modelIds: p.modelIds,
        currentModelId: p.currentModelId,
        enabled: p.enabled,
        allowFrontend: p.allowFrontend,
      }))
      const data = await api<{ providers: Provider[] }>('/api/admin/ai-models', {
        method: 'PUT',
        body: JSON.stringify({ providers: payload }),
      })
      if (seq !== saveSeq.current) return
      setProviders(data.providers)
      setTestPlatform((prev) => (data.providers.some((p) => p.platformId === prev) ? prev : data.providers[0]?.platformId || ''))
      setSavedAt(Date.now())
    } catch (e) {
      if (seq !== saveSeq.current) return
      show('error', '自动保存失败：' + (e as Error).message)
      // 保存失败回滚到服务端最新状态，避免本地与后端不一致
      try {
        const fresh = await api<{ providers: Provider[] }>('/api/admin/ai-models')
        setProviders(fresh.providers)
      } catch {
        /* 回滚拉取失败时保留当前视图，下次变更会再次尝试保存 */
      }
    } finally {
      if (seq === saveSeq.current) setSaving(false)
    }
  }

  const onDialogConfirm = (value: AiDialogValue) => {
    const preset = presets.find((p) => p.id === value.platformId)
    const base = {
      platformId: value.platformId,
      platformName: preset?.name ?? value.platformId,
      short: preset?.short ?? value.platformId.slice(0, 2).toUpperCase(),
      color: preset?.color ?? '#5c6b82',
      baseURL: preset?.baseURL ?? '',
      keyUrl: preset?.keyUrl ?? '',
      docs: preset?.docs ?? '',
      // 编辑时若用户留空 Key，保留原有值（含脱敏占位），不要清掉
      apiKeyMasked: value.apiKey || providers[editing ?? -1]?.apiKeyMasked || '',
      modelIds: value.modelIds,
      currentModelId:
        providers[editing ?? -1]?.currentModelId && value.modelIds.includes(providers[editing!].currentModelId)
          ? providers[editing!].currentModelId
          : value.modelIds[0],
      enabled: editing != null ? providers[editing].enabled : true,
      allowFrontend: editing != null ? providers[editing].allowFrontend : false,
    }
    const next = (() => {
      if (editing == null) return [...providers, { index: providers.length, ...base }]
      return providers.map((p, i) => (i === editing ? { index: i, ...base } : p))
    })()
    setProviders(next)
    setDialogOpen(false)
    setEditing(null)
    void autoSave(next)
  }

  const update = (i: number, patch: Partial<Provider>) => {
    const next = providers.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
    setProviders(next)
    void autoSave(next)
  }
  const remove = (i: number) => {
    const next = providers.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, index: idx }))
    setProviders(next)
    void autoSave(next)
  }

  const runTest = async () => {
    if (!testPlatform) {
      show('error', '请先配置并保存一个平台')
      return
    }
    setTesting(true)
    setTestResult(null)
    setTestError('')
    try {
      const data = await api<TestResult>('/api/admin/ai-models', {
        method: 'POST',
        body: JSON.stringify({ platformId: testPlatform, modelId: testModel || undefined, prompt: testPrompt }),
      })
      setTestResult(data)
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const configuredCount = providers.filter((p) => p.apiKeyMasked).length
  const totalModels = providers.reduce((n, p) => n + (p.modelIds?.length ?? 0), 0)
  const hasProviders = providers.length > 0

  return (
    <div className="ai-page">
      <style>{AI_CSS}</style>
      <Toast toast={toast} />
      <AiPlatformDialog
        open={dialogOpen}
        presets={presets}
        initial={dialogInitial()}
        onClose={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
        onConfirm={onDialogConfirm}
      />

      <div className="ai-hero ai-card-surface">
        <div className="ai-hero__left">
          <div className="ai-top__icon" aria-hidden="true">
            <ShellIcon name="ai" size={22} />
          </div>
          <div>
            <h1 className="ai-top__title">AI 模型</h1>
            <p className="ai-top__desc">选平台、填 Key、拉取并选用模型（可多选、可切换）。Key 只在服务端保存与调用。</p>
          </div>
        </div>
        <div className="ai-save-state" aria-live="polite">
          {saving ? (
            <>
              <svg className="ai-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              保存中…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              已自动保存
            </>
          )}
        </div>
      </div>

      {hasProviders && (
        <div className="ai-stats">
          <div className="ai-stat ai-card-surface">
            <div className="ai-stat__icon ai-stat__icon--1">
              <StatIcon type="platform" />
            </div>
            <div className="ai-stat__body">
              <span className="ai-stat__num">{configuredCount}</span>
              <span className="ai-stat__label">已配置平台</span>
            </div>
          </div>
          <div className="ai-stat ai-card-surface">
            <div className="ai-stat__icon ai-stat__icon--2">
              <StatIcon type="model" />
            </div>
            <div className="ai-stat__body">
              <span className="ai-stat__num">{totalModels}</span>
              <span className="ai-stat__label">可用模型</span>
            </div>
          </div>
          <div className="ai-stat ai-card-surface">
            <div className="ai-stat__icon ai-stat__icon--3">
              <StatIcon type="active" />
            </div>
            <div className="ai-stat__body">
              <span className="ai-stat__num">{providers.filter((p) => p.enabled).length}</span>
              <span className="ai-stat__label">已启用</span>
            </div>
          </div>
        </div>
      )}

      <div className="ai-layout">
        <section className="ai-card-surface ai-section">
          <div className="ai-card-head">
            <div>
              <h2 className="ai-section-title">已配置平台</h2>
              <p className="ai-section-sub">
                {configuredCount > 0 ? `${configuredCount} 个平台 · ${totalModels} 个模型` : '添加第一个平台开始使用'}
              </p>
            </div>
            <button className="ai-btn ai-btn--primary ai-btn--sm" onClick={openAdd} disabled={!presets.length}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              添加平台
            </button>
          </div>
          <div className="ai-card-body">
            {loading ? (
              <div className="ai-empty">
                <p className="ai-empty__desc">加载中…</p>
              </div>
            ) : providers.length === 0 ? (
              <div className="ai-empty">
                <div className="ai-empty__illustration">
                  <EmptyIllustration />
                </div>
                <p className="ai-empty__title">还没有配置平台</p>
                <p className="ai-empty__desc">
                  点「添加平台」，选一个平台填入 API Key，系统会自动拉取该账号可用的模型供你选择。
                </p>
                <button className="ai-btn ai-btn--primary" onClick={openAdd}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  添加第一个平台
                </button>
              </div>
            ) : (
              providers.map((p, i) => (
                <div
                  className={`ai-card${p.enabled ? '' : ' ai-card--off'}`}
                  key={i}
                  style={{ ['--brand' as string]: p.color }}
                >
                  <div className="ai-card__glow" aria-hidden="true" />
                  <div className="ai-card__top">
                    <div className="ai-brand">
                      <PlatformIcon id={p.platformId} size={22} />
                    </div>
                    <div className="ai-card__meta">
                      <p className="ai-card__name">
                        {p.platformName}
                        {p.enabled ? (
                          <span className="ai-badge ai-badge--on">已启用</span>
                        ) : (
                          <span className="ai-badge ai-badge--off">已停用</span>
                        )}
                        {p.allowFrontend && <span className="ai-badge ai-badge--front">前台可用</span>}
                      </p>
                      <div className="ai-card__url" title={p.baseURL}>
                        {p.baseURL}
                      </div>
                    </div>
                    <div className="ai-card__ops">
                      <button className="ai-icon" title="编辑" aria-label="编辑平台" onClick={() => openEdit(i)}>
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        className="ai-icon ai-icon--danger"
                        title="删除"
                        aria-label="删除平台"
                        onClick={() => remove(i)}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="ai-card__section">
                    <div className="ai-section-label">
                      <span>可用模型（{p.modelIds?.length ?? 0}）</span>
                      <a className="ai-link" href={p.docs} target="_blank" rel="noreferrer">
                        文档 ↗
                      </a>
                    </div>
                    <div className="ai-chips">
                      {(p.modelIds ?? []).map((id) => (
                        <button
                          key={id}
                          className={`ai-chip${id === p.currentModelId ? ' ai-chip--current' : ''}`}
                          title={id === p.currentModelId ? '当前使用模型' : '点击切换为当前模型'}
                          onClick={() => update(i, { currentModelId: id })}
                        >
                          <span className="ai-chip__dot" /> {id}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ai-card__foot">
                    <label className="ai-switch">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })}
                      />
                      <span className="ai-track" aria-hidden="true" />
                      <span className="ai-switch__label">启用此平台</span>
                    </label>
                    <label className="ai-current">
                      <span className="ai-current__label">当前模型</span>
                      <select
                        className="ai-select"
                        value={p.currentModelId}
                        onChange={(e) => update(i, { currentModelId: e.target.value })}
                      >
                        {(p.modelIds ?? []).map((id) => (
                          <option value={id} key={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ai-switch">
                      <input
                        type="checkbox"
                        checked={p.allowFrontend}
                        onChange={(e) => update(i, { allowFrontend: e.target.checked })}
                      />
                      <span className="ai-track" aria-hidden="true" />
                      <span className="ai-switch__label">允许前台调用</span>
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ai-card-surface ai-section ai-section--test">
          <div className="ai-card-head">
            <div>
              <h2 className="ai-section-title">在线测试</h2>
              <p className="ai-section-sub">配置已自动保存，可在此验证模型调用</p>
            </div>
          </div>
          <div className="ai-card-body">
            {!hasProviders ? (
              <div className="ai-test-empty">
                <div className="ai-test-empty__icon">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5v14" />
                  </svg>
                </div>
                <p className="ai-test-empty__title">暂无可测试的平台</p>
                <p className="ai-test-empty__desc">先在左侧添加并保存一个平台配置，即可在此发送测试请求。</p>
              </div>
            ) : (
              <div className="ai-test__flow">
                <div className="ai-tip">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <span>选好平台与模型，输入提示词后发送，可快速验证配置是否生效。</span>
                </div>
                <div className="ai-field">
                  <label className="ai-label">平台</label>
                  <select
                    className="ai-test-select"
                    value={testPlatform}
                    onChange={(e) => setTestPlatform(e.target.value)}
                  >
                    {providers.map((p, i) => (
                      <option value={p.platformId} key={i}>
                        {p.platformName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ai-field">
                  <label className="ai-label">模型（可切换）</label>
                  <select
                    className="ai-test-select"
                    value={testModel}
                    onChange={(e) => setTestModel(e.target.value)}
                    disabled={!testModel}
                  >
                    {(providers.find((p) => p.platformId === testPlatform)?.modelIds ?? []).map((id) => (
                      <option value={id} key={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ai-field">
                  <label className="ai-label" htmlFor="ai-prompt">
                    提示词
                  </label>
                  <textarea
                    id="ai-prompt"
                    className="ai-input"
                    rows={4}
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    placeholder="输入要发送给模型的提示词…"
                  />
                </div>
                <button
                  className="ai-btn ai-btn--primary ai-btn--block"
                  onClick={runTest}
                  disabled={testing || !testPlatform}
                >
                  {testing ? (
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
                      调用中…
                    </>
                  ) : (
                    <>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m22 2-7 20-4-9-9-4Z" />
                        <path d="M22 2 11 13" />
                      </svg>
                      发送测试
                    </>
                  )}
                </button>
                {testError && (
                  <div className="ai-result ai-result--err">
                    <div className="ai-result__head">
                      <ShellIcon name="close" size={13} /> 调用失败
                    </div>
                    <pre className="ai-result__body">{testError}</pre>
                  </div>
                )}
                {testResult && (
                  <div className="ai-result">
                    <div className="ai-result__head">
                      <ShellIcon name="ai" size={13} /> {testResult.model}
                      {testResult.latencyMs != null ? (
                        <span className="ai-result__latency">· {(testResult.latencyMs / 1000).toFixed(1)}s</span>
                      ) : null}
                    </div>
                    <pre className="ai-result__body">{testResult.content || '（空回复）'}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** 主页样式：ai- 前缀，全部走后台主题变量 */
const AI_CSS = `
/* AI 模型管理主页 · 走后台主题变量 */
.ai-page{padding:0 0 2.5rem;max-width:1200px;display:flex;flex-direction:column;gap:1.15rem}

/* 统一卡片基色：页面里所有区块共用同一套圆角/描边/阴影语言，避免割裂 */
.ai-card-surface{background:var(--theme-elevation-0);border:1px solid var(--theme-elevation-150);border-radius:14px;box-shadow:0 1px 3px rgb(20 27 38 / .05)}
html[data-theme='dark'] .ai-card-surface{box-shadow:0 1px 3px rgb(0 0 0 / .25)}

/* 顶部 Hero 卡片 */
.ai-hero{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.1rem 1.4rem}
.ai-hero__left{display:flex;align-items:center;gap:.9rem;min-width:0}
.ai-top__icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--accent-hover));color:#fff;flex-shrink:0;box-shadow:0 4px 12px -2px rgb(79 147 245 / .4)}
html[data-theme='dark'] .ai-top__icon{box-shadow:0 4px 14px -2px rgb(79 147 245 / .5)}
.ai-top__title{font-size:1.25rem;font-weight:700;margin:0;line-height:1.3;color:var(--theme-elevation-900)}
html[data-theme='dark'] .ai-top__title{color:var(--theme-elevation-100)}
.ai-top__desc{font-size:.83rem;color:var(--theme-elevation-500);margin:.2rem 0 0;line-height:1.5}
.ai-save-state{display:inline-flex;align-items:center;gap:.45rem;flex-shrink:0;font-size:.78rem;font-weight:600;color:var(--accent-text);background:var(--accent-soft);border-radius:20px;padding:.4rem .8rem}

/* 统计卡片 */
.ai-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.ai-stat{padding:.9rem 1.1rem;display:flex;align-items:center;gap:.8rem;transition:border-color 160ms ease,box-shadow 160ms ease}
.ai-stat:hover{border-color:var(--theme-elevation-250);box-shadow:0 4px 12px -6px rgb(20 27 38 / .12)}
.ai-stat__icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ai-stat__icon--1{background:var(--accent-soft);color:var(--accent-text)}
.ai-stat__icon--2{background:#fef3e7;color:#e08a2e}
html[data-theme='dark'] .ai-stat__icon--2{background:#2a1f10;color:#f0b46e}
.ai-stat__icon--3{background:#e6f7ee;color:#0a7a44}
html[data-theme='dark'] .ai-stat__icon--3{background:#123328;color:#5fd39a}
.ai-stat__body{display:flex;flex-direction:column;gap:.05rem;min-width:0}
.ai-stat__num{font-size:1.45rem;font-weight:700;color:var(--theme-elevation-900);line-height:1.2}
html[data-theme='dark'] .ai-stat__num{color:var(--theme-elevation-100)}
.ai-stat__label{font-size:.76rem;color:var(--theme-elevation-500)}

/* 按钮 */
.ai-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--theme-elevation-250);border-radius:9px;padding:.55rem 1rem;font-size:.85rem;font-weight:600;cursor:pointer;background:var(--theme-elevation-0);color:var(--theme-text);font-family:inherit;transition:all 160ms ease;white-space:nowrap}
.ai-btn:hover{border-color:var(--accent);color:var(--accent-text);background:var(--accent-soft)}
.ai-btn:active{transform:translateY(1px)}
.ai-btn:focus-visible{outline:none;box-shadow:var(--ring);border-color:var(--accent)}
.ai-btn:disabled{opacity:.5;cursor:not-allowed}
.ai-btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.ai-btn--primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
.ai-btn--ghost{background:transparent}
.ai-btn--sm{padding:.4rem .75rem;font-size:.8rem}
.ai-btn--block{width:100%;padding:.65rem 1rem;font-size:.88rem}

/* 布局 */
.ai-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(320px,1fr);gap:1.15rem;align-items:start}
@media(max-width:1000px){.ai-layout{grid-template-columns:1fr}}
.ai-section{overflow:hidden}
.ai-card-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.35rem;border-bottom:1px solid var(--theme-elevation-150);background:var(--theme-elevation-50)}
.ai-section-title{font-size:1rem;font-weight:650;margin:0;color:var(--theme-elevation-900)}
html[data-theme='dark'] .ai-section-title{color:var(--theme-elevation-100)}
.ai-section-sub{font-size:.78rem;color:var(--theme-elevation-500);margin:.2rem 0 0}
.ai-card-body{padding:1.25rem 1.35rem}

/* 空状态 */
.ai-empty{padding:3rem 1.5rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.6rem}
.ai-empty__illustration{margin-bottom:.6rem;animation:ai-float 4s ease-in-out infinite}
@keyframes ai-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.ai-empty__title{font-size:1.1rem;font-weight:700;margin:0;color:var(--theme-elevation-900)}
html[data-theme='dark'] .ai-empty__title{color:var(--theme-elevation-100)}
.ai-empty__desc{font-size:.85rem;color:var(--theme-elevation-500);margin:0 0 1rem;max-width:380px;line-height:1.6}

/* 平台卡片（嵌在 section 卡片内的子卡） */
.ai-card{position:relative;border:1px solid var(--theme-elevation-200);border-radius:12px;padding:1.1rem 1.2rem;margin-bottom:1rem;background:var(--theme-elevation-50);transition:border-color 160ms ease,box-shadow 160ms ease;overflow:hidden}
.ai-card:last-child{margin-bottom:0}
.ai-card:hover{border-color:var(--theme-elevation-300);box-shadow:0 4px 12px -6px rgb(20 27 38 / .1)}
.ai-card:focus-within{border-color:var(--accent);box-shadow:var(--ring)}
.ai-card--off{opacity:.7;background:var(--theme-elevation-100)}
.ai-card__glow{position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--brand,var(--accent)),transparent);opacity:.9}
.ai-card__top{display:flex;align-items:center;gap:.8rem;margin-bottom:.9rem}
.ai-brand{width:44px;height:44px;flex-shrink:0;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--theme-elevation-50);border:1px solid var(--theme-elevation-150)}
.ai-brand img,.ai-brand svg{width:100%;height:100%;object-fit:contain;display:block}
.ai-card__meta{flex:1;min-width:0}
.ai-card__name{font-size:.96rem;font-weight:650;margin:0 0 .2rem;display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;color:var(--theme-elevation-900)}
html[data-theme='dark'] .ai-card__name{color:var(--theme-elevation-100)}
.ai-card__url{font-size:.74rem;color:var(--theme-elevation-500);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-badge{display:inline-flex;align-items:center;font-size:.68rem;font-weight:600;padding:.15rem .55rem;border-radius:20px;line-height:1.6}
.ai-badge--on{background:var(--accent-soft);color:var(--accent-text)}
.ai-badge--off{background:var(--theme-elevation-150);color:var(--theme-elevation-500)}
.ai-badge--front{background:#e6f7ee;color:#0a7a44}
html[data-theme='dark'] .ai-badge--front{background:#123328;color:#5fd39a}
.ai-card__ops{display:flex;gap:.25rem}
.ai-icon{border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.4rem;border-radius:8px;display:flex;transition:background 140ms ease,color 140ms ease}
.ai-icon:hover{background:var(--accent-soft);color:var(--accent-text)}
.ai-icon--danger:hover{background:var(--danger-soft);color:var(--danger)}
.ai-icon:focus-visible{outline:none;box-shadow:var(--ring)}

/* 模型区 */
.ai-card__section{margin-bottom:.9rem}
.ai-section-label{font-size:.76rem;font-weight:650;color:var(--theme-elevation-500);margin:0 0 .55rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.ai-link{font-size:.75rem;color:var(--accent-text);text-decoration:none}
.ai-link:hover{text-decoration:underline}
.ai-chips{display:flex;flex-wrap:wrap;gap:.4rem}
.ai-chip{display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;padding:.32rem .65rem;border-radius:18px;border:1px solid var(--theme-elevation-250);background:var(--theme-elevation-50);color:var(--theme-elevation-600);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:100%;cursor:pointer;transition:all 140ms ease}
.ai-chip:hover{border-color:var(--theme-elevation-350);background:var(--theme-elevation-100)}
html[data-theme='dark'] .ai-chip{color:var(--theme-elevation-300)}
.ai-chip--current{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text);font-weight:600}
.ai-chip--current:hover{background:var(--accent-soft);border-color:var(--accent)}
.ai-chip__dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;opacity:.6}
.ai-chip--current .ai-chip__dot{opacity:1}

/* 卡片底部 */
.ai-card__foot{display:flex;align-items:center;gap:1.2rem;margin-top:.2rem;padding-top:.85rem;border-top:1px dashed var(--theme-elevation-200);flex-wrap:wrap}
.ai-switch{display:inline-flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--theme-elevation-600);cursor:pointer;user-select:none}
html[data-theme='dark'] .ai-switch{color:var(--theme-elevation-300)}
.ai-switch input{position:absolute;opacity:0;width:0;height:0}
.ai-track{width:36px;height:20px;border-radius:20px;background:var(--theme-elevation-250);position:relative;transition:background 160ms ease;flex-shrink:0}
.ai-track::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / .2);transition:transform 160ms ease}
.ai-switch input:checked+.ai-track{background:var(--accent)}
.ai-switch input:checked+.ai-track::after{transform:translateX(16px)}
.ai-switch input:focus-visible+.ai-track{box-shadow:var(--ring)}
.ai-switch__label{white-space:nowrap}
.ai-current{display:flex;align-items:center;gap:.5rem;font-size:.8rem;margin-left:auto}
.ai-current__label{color:var(--theme-elevation-500);white-space:nowrap}
.ai-select{border:1px solid var(--theme-elevation-250);border-radius:8px;padding:.4rem .6rem;font-size:.8rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit;max-width:230px;cursor:pointer}
.ai-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}

/* 测试面板 */
.ai-test-empty{padding:2rem 1rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.5rem}
.ai-test-empty__icon{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:var(--theme-elevation-100);color:var(--theme-elevation-400);margin-bottom:.3rem}
.ai-test-empty__title{font-size:.92rem;font-weight:600;margin:0;color:var(--theme-elevation-700)}
html[data-theme='dark'] .ai-test-empty__title{color:var(--theme-elevation-300)}
.ai-test-empty__desc{font-size:.8rem;color:var(--theme-elevation-500);margin:0;max-width:280px;line-height:1.55}

.ai-test__flow{display:flex;flex-direction:column;gap:.85rem}
.ai-tip{display:flex;gap:.55rem;padding:.7rem .85rem;border-radius:10px;background:var(--accent-soft);color:var(--accent-text);font-size:.78rem;line-height:1.55}
.ai-tip svg{flex-shrink:0;margin-top:.05rem}
.ai-field{display:flex;flex-direction:column;gap:.4rem}
.ai-label{font-size:.78rem;font-weight:620;color:var(--theme-elevation-700)}
html[data-theme='dark'] .ai-label{color:var(--theme-elevation-300)}
.ai-input,.ai-test-select{width:100%;box-sizing:border-box;border:1px solid var(--theme-elevation-250);border-radius:9px;padding:.55rem .7rem;font-size:.85rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit;transition:border-color 140ms ease,box-shadow 140ms ease}
.ai-input::placeholder{color:var(--theme-elevation-400)}
.ai-input:focus,.ai-test-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.ai-spin{animation:ai-spin .8s linear infinite}
@keyframes ai-spin{to{transform:rotate(360deg)}}

.ai-result{margin-top:.2rem;border:1px solid var(--theme-elevation-200);border-radius:11px;overflow:hidden;background:var(--theme-elevation-50)}
.ai-result__head{display:flex;align-items:center;gap:.45rem;padding:.55rem .8rem;background:var(--theme-elevation-100);font-size:.74rem;color:var(--theme-elevation-600);border-bottom:1px solid var(--theme-elevation-200)}
html[data-theme='dark'] .ai-result__head{color:var(--theme-elevation-300)}
.ai-result__latency{opacity:.7;margin-left:.1rem}
.ai-result__body{padding:.85rem .9rem;font-size:.86rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:0}
.ai-result--err{border-color:var(--danger)}
.ai-result--err .ai-result__head{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
@media(prefers-reduced-motion:reduce){.ai-btn,.ai-card,.ai-track,.ai-track::after,.ai-empty__icon-ring,.ai-spin{transition:none;animation:none}}
`
