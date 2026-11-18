'use client'

/**
 * AI 模型管理主页：各区块卡片包裹；平台配置走弹窗拉取模型；已选模型可切换当前使用模型。
 */
import { useCallback, useEffect, useState } from 'react'

import { useToast, Toast } from '../../components/Toast'
import { ShellIcon } from '../../shell/icons'
import { AiPlatformDialog, type AiDialogValue, type AiPresetOption } from './AiPlatformDialog'

type Preset = AiPresetOption & { keyUrl: string; docs: string; models: unknown[]; defaultModel: string }
type Provider = {
  index: number; platformId: string; platformName: string; short: string; color: string; baseURL: string;
  keyUrl: string; docs: string; apiKeyMasked: string; modelIds: string[]; currentModelId: string;
  enabled: boolean; allowFrontend: boolean
}
type TestResult = { content: string; model: string; usage?: unknown; latencyMs?: number } | null

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || '请求失败')
  return data as T
}

export function AiModelsViewInner() {
  const { toast, show } = useToast()
  const [presets, setPresets] = useState<Preset[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
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
      setDirty(false)
    } catch (e) { show('error', '加载失败：' + (e as Error).message) }
    finally { setLoading(false) }
  }, [show])
  useEffect(() => { load() }, [load])

  // 测试面板：平台变化时模型选项跟随；模型默认取该平台当前模型
  useEffect(() => {
    const p = providers.find((x) => x.platformId === testPlatform)
    setTestModel(p?.currentModelId || p?.modelIds?.[0] || '')
  }, [testPlatform, providers])

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (i: number) => { setEditing(i); setDialogOpen(true) }

  const dialogInitial = (): AiDialogValue | null => {
    if (editing == null) return null
    const p = providers[editing]
    if (!p) return null
    return { platformId: p.platformId, apiKey: p.apiKeyMasked.includes('••') ? '' : p.apiKeyMasked, modelIds: p.modelIds }
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
      apiKeyMasked: value.apiKey,
      modelIds: value.modelIds,
      currentModelId: providers[editing ?? -1]?.currentModelId && value.modelIds.includes(providers[editing!].currentModelId) ? providers[editing!].currentModelId : value.modelIds[0],
      enabled: editing != null ? providers[editing].enabled : true,
      allowFrontend: editing != null ? providers[editing].allowFrontend : false,
    }
    setProviders((prev) => {
      if (editing == null) return [...prev, { index: prev.length, ...base }]
      return prev.map((p, i) => (i === editing ? { index: i, ...base } : p))
    })
    setDirty(true)
    setDialogOpen(false)
    setEditing(null)
  }

  const update = (i: number, patch: Partial<Provider>) => {
    setProviders((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
    setDirty(true)
  }
  const remove = (i: number) => {
    setProviders((prev) => prev.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, index: idx })))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const data = await api<{ providers: Provider[] }>('/api/admin/ai-models', {
        method: 'PUT',
        body: JSON.stringify({ providers }),
      })
      setProviders(data.providers)
      setTestPlatform(data.providers[0]?.platformId || '')
      setDirty(false)
      show('success', '保存成功')
    } catch (e) { show('error', '保存失败：' + (e as Error).message) }
    finally { setSaving(false) }
  }

  const runTest = async () => {
    if (!testPlatform) { show('error', '请先配置并保存一个平台'); return }
    setTesting(true); setTestResult(null); setTestError('')
    try {
      const data = await api<TestResult>('/api/admin/ai-models', {
        method: 'POST',
        body: JSON.stringify({ platformId: testPlatform, modelId: testModel || undefined, prompt: testPrompt }),
      })
      setTestResult(data)
    } catch (e) { setTestError((e as Error).message) }
    finally { setTesting(false) }
  }

  const configuredCount = providers.filter((p) => p.apiKeyMasked).length
  const totalModels = providers.reduce((n, p) => n + (p.modelIds?.length ?? 0), 0)

  return (
    <div className="ai-page">
      <style>{AI_CSS}</style>
      <Toast toast={toast} />
      <AiPlatformDialog open={dialogOpen} presets={presets} initial={dialogInitial()} onClose={() => { setDialogOpen(false); setEditing(null) }} onConfirm={onDialogConfirm} />

      <div className="ai-top">
        <div>
          <h1 className="ai-top__title">AI 模型</h1>
          <p className="ai-top__desc">选平台、填 Key、拉取并选用模型（可多选、可切换）。Key 只在服务端保存与调用。</p>
        </div>
        <div style={{ display: 'flex', gap: '.6rem' }}>
          <button className="ai-btn ai-btn--ghost" onClick={load}>刷新</button>
          <button className="ai-btn ai-btn--primary" onClick={save} disabled={!dirty || saving}>{saving ? '保存中…' : dirty ? '保存更改' : '已保存'}</button>
        </div>
      </div>

      <div className="ai-layout">
        <section className="ai-panel">
          <div className="ai-panel__head">
            <div>
              <h2 className="ai-panel__title"><ShellIcon name='ai' size={18} /> 已配置平台</h2>
              <p className="ai-panel__sub">{configuredCount > 0 ? `${configuredCount} 个平台 · ${totalModels} 个模型` : '添加第一个平台开始使用'}</p>
            </div>
            <button className="ai-btn ai-btn--primary ai-btn--sm" onClick={openAdd} disabled={!presets.length}>＋ 添加平台</button>
          </div>
          <div className="ai-panel__body">
            {loading ? <div className="ai-empty"><p className="ai-empty__desc">加载中…</p></div> : providers.length === 0 ? (
              <div className="ai-empty">
                <div className="ai-empty__icon"><ShellIcon name='ai' size={28} /></div>
                <p className="ai-empty__title">还没有配置平台</p>
                <p className="ai-empty__desc">点「添加平台」，选一个平台填入 API Key，系统会自动拉取该账号可用的模型供你选择。</p>
                <button className="ai-btn ai-btn--primary" onClick={openAdd}>＋ 添加第一个平台</button>
              </div>
            ) : providers.map((p, i) => (
              <div className={`ai-card${p.enabled ? '' : ' ai-card--off'}`} key={i}>
                <div className="ai-card__top">
                  <div className="ai-brand" style={{ background: p.color }} aria-hidden='true'>{p.short}</div>
                  <div className="ai-card__meta">
                    <p className="ai-card__name">
                      {p.platformName}
                      <span className={`ai-badge ${p.enabled ? 'ai-badge--on' : 'ai-badge--off'}`}>{p.enabled ? '已启用' : '已停用'}</span>
                      {p.allowFrontend && <span className="ai-badge ai-badge--front">前台可用</span>}
                    </p>
                    <div className="ai-card__url" title={p.baseURL}>{p.baseURL}</div>
                  </div>
                  <div className="ai-card__ops">
                    <button className="ai-icon" title='编辑' aria-label='编辑平台' onClick={() => openEdit(i)}>
                      <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round'><path d='M4 20h4l10-10-4-4L4 16v4zM14.5 5.5l4 4'/></svg>
                    </button>
                    <button className="ai-icon ai-icon--danger" title='删除' aria-label='删除平台' onClick={() => remove(i)}>
                      <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round'><path d='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'/></svg>
                    </button>
                  </div>
                </div>

                <p className="ai-section-label"><span>可用模型（{p.modelIds?.length ?? 0}）</span><a className="ai-link" href={p.docs} target='_blank' rel='noreferrer'>文档 ↗</a></p>
                <div className="ai-chips">
                  {(p.modelIds ?? []).map((id) => (
                    <button key={id} className={`ai-chip${id === p.currentModelId ? ' ai-chip--current' : ''}`}
                      title={id === p.currentModelId ? '当前使用模型' : '点击切换为当前模型'}
                      onClick={() => update(i, { currentModelId: id })}>
                      <span className="ai-chip__dot" /> {id}
                    </button>
                  ))}
                </div>

                <div className="ai-card__foot">
                  <label className="ai-switch">
                    <input type='checkbox' checked={p.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                    <span className="ai-track" aria-hidden='true' /> 启用此平台
                  </label>
                  <label className="ai-current">当前模型：
                    <select className="ai-select" value={p.currentModelId} onChange={(e) => update(i, { currentModelId: e.target.value })}>
                      {(p.modelIds ?? []).map((id) => <option value={id} key={id}>{id}</option>)}
                    </select>
                  </label>
                  <label className="ai-switch">
                    <input type='checkbox' checked={p.allowFrontend} onChange={(e) => update(i, { allowFrontend: e.target.checked })} />
                    <span className="ai-track" aria-hidden='true' /> 允许前台调用
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ai-panel">
          <div className="ai-panel__head"><h2 className="ai-panel__title">在线测试</h2></div>
          <div className="ai-panel__body">
            <div className="ai-test__flow">
              <div className="ai-tip">
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8h.01'/></svg>
                <span>先保存配置，再选平台/模型发一条消息验证。这里可切换模型测试。</span>
              </div>
              <div className="ai-field">
                <label className="ai-label">平台</label>
                <select className="ai-test-select" value={testPlatform} onChange={(e) => setTestPlatform(e.target.value)} disabled={!providers.length}>
                  {providers.map((p, i) => <option value={p.platformId} key={i}>{p.platformName}</option>)}
                </select>
              </div>
              <div className="ai-field">
                <label className="ai-label">模型（可切换）</label>
                <select className="ai-test-select" value={testModel} onChange={(e) => setTestModel(e.target.value)} disabled={!testModel}>
                  {(providers.find((p) => p.platformId === testPlatform)?.modelIds ?? []).map((id) => <option value={id} key={id}>{id}</option>)}
                </select>
              </div>
              <div className="ai-field">
                <label className="ai-label" htmlFor='ai-prompt'>提示词</label>
                <textarea id='ai-prompt' className="ai-input" rows={4} value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
              </div>
              <button className="ai-btn ai-btn--primary" onClick={runTest} disabled={testing || !testPlatform}>{testing ? '调用中…' : '发送测试'}</button>
              {testError && <div className="ai-result ai-result--err"><div className="ai-result__head"><ShellIcon name='close' size={13} /> 调用失败</div><pre className="ai-result__body">{testError}</pre></div>}
              {testResult && <div className="ai-result"><div className="ai-result__head"><ShellIcon name='ai' size={13} /> {testResult.model}{testResult.latencyMs != null ? ` · ${(testResult.latencyMs / 1000).toFixed(1)}s` : ''}</div><pre className="ai-result__body">{testResult.content || '（空回复）'}</pre></div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/** 主页样式：ai- 前缀，全部走后台主题变量 */
const AI_CSS = `
/* AI 模型管理主页 · 走后台主题变量 */
.ai-page{padding:0 0 2.5rem;max-width:1180px;display:flex;flex-direction:column;gap:1.15rem}
.ai-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:var(--theme-elevation-0);border:var(--card-line);border-radius:var(--card-radius);padding:1rem 1.35rem}
.ai-top__title{font-size:1.2rem;font-weight:650;margin:0 0 .25rem}
.ai-top__desc{font-size:.83rem;color:var(--theme-elevation-500);margin:0;line-height:1.5}
.ai-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.55rem 1rem;font-size:.85rem;font-weight:550;cursor:pointer;background:var(--theme-elevation-0);color:var(--theme-text);font-family:inherit;transition:background 140ms ease,border-color 140ms ease,box-shadow 140ms ease,transform 100ms ease;white-space:nowrap}
.ai-btn:hover{border-color:var(--accent);color:var(--accent-text)}
.ai-btn:active{transform:translateY(1px)}
.ai-btn:focus-visible{outline:none;box-shadow:var(--ring);border-color:var(--accent)}
.ai-btn:disabled{opacity:.5;cursor:not-allowed}
.ai-btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.ai-btn--primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
.ai-btn--ghost{background:transparent}
.ai-btn--sm{padding:.35rem .7rem;font-size:.8rem}

.ai-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,1fr);gap:1.15rem;align-items:start}
@media(max-width:1000px){.ai-layout{grid-template-columns:1fr}}
.ai-panel{background:var(--theme-elevation-0);border:var(--card-line);border-radius:var(--card-radius);overflow:hidden}
.ai-panel__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.35rem;border-bottom:1px solid var(--theme-elevation-150);background:var(--theme-elevation-50)}
.ai-panel__title{display:flex;align-items:center;gap:.6rem;font-size:.98rem;font-weight:620;margin:0}
.ai-panel__title svg{color:var(--accent)}
.ai-panel__sub{font-size:.78rem;color:var(--theme-elevation-500);margin:.25rem 0 0}
.ai-panel__body{padding:1.25rem 1.35rem}

.ai-empty{padding:2.5rem 1.5rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.5rem}
.ai-empty__icon{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent-text);margin-bottom:.4rem}
.ai-empty__title{font-size:1rem;font-weight:620;margin:0}
.ai-empty__desc{font-size:.85rem;color:var(--theme-elevation-500);margin:0 0 1rem;max-width:380px;line-height:1.6}

.ai-card{border:1px solid var(--theme-elevation-200);border-radius:11px;padding:1.1rem 1.15rem;margin-bottom:1rem;background:var(--theme-elevation-0);transition:border-color 160ms ease,box-shadow 160ms ease}
.ai-card:last-child{margin-bottom:0}
.ai-card:hover{border-color:var(--theme-elevation-300)}
.ai-card:focus-within{border-color:var(--accent);box-shadow:var(--ring)}
.ai-card--off{opacity:.7;background:var(--theme-elevation-50)}
.ai-card__top{display:flex;align-items:center;gap:.75rem;margin-bottom:.9rem}
.ai-brand{width:42px;height:42px;flex-shrink:0;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.9rem;box-shadow:0 2px 6px rgb(20 27 38 / .14)}
.ai-card__meta{flex:1;min-width:0}
.ai-card__name{font-size:.95rem;font-weight:620;margin:0 0 .2rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.ai-card__url{font-size:.74rem;color:var(--theme-elevation-500);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-badge{display:inline-flex;align-items:center;font-size:.68rem;font-weight:600;padding:.15rem .5rem;border-radius:20px;line-height:1.6}
.ai-badge--on{background:var(--accent-soft);color:var(--accent-text)}
.ai-badge--off{background:var(--theme-elevation-150);color:var(--theme-elevation-500)}
.ai-badge--front{background:#e6f7ee;color:#0a7a44}
html.dark .ai-badge--front{background:#123328;color:#5fd39a}
.ai-card__ops{display:flex;gap:.3rem}
.ai-icon{border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.35rem;border-radius:7px;display:flex;transition:background 140ms ease,color 140ms ease}
.ai-icon:hover{background:var(--accent-soft);color:var(--accent-text)}
.ai-icon--danger:hover{background:var(--danger-soft);color:var(--danger)}
.ai-icon:focus-visible{outline:none;box-shadow:var(--ring)}
.ai-section-label{font-size:.76rem;font-weight:620;color:var(--theme-elevation-600);margin:0 0 .5rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
html.dark .ai-section-label{color:var(--theme-elevation-300)}
.ai-chips{display:flex;flex-wrap:wrap;gap:.4rem}
.ai-chip{display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;padding:.28rem .6rem;border-radius:18px;border:1px solid var(--theme-elevation-250);background:var(--theme-elevation-50);color:var(--theme-elevation-600);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:100%}
html.dark .ai-chip{color:var(--theme-elevation-300)}
.ai-chip--current{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text);font-weight:600}
.ai-chip__dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.ai-card__foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.9rem;padding-top:.8rem;border-top:1px dashed var(--theme-elevation-200);flex-wrap:wrap}
.ai-switch{display:inline-flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--theme-elevation-600);cursor:pointer;user-select:none}
html.dark .ai-switch{color:var(--theme-elevation-300)}
.ai-switch input{position:absolute;opacity:0;width:0;height:0}
.ai-track{width:34px;height:19px;border-radius:20px;background:var(--theme-elevation-250);position:relative;transition:background 160ms ease;flex-shrink:0}
.ai-track::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .2);transition:transform 160ms ease}
.ai-switch input:checked+.ai-track{background:var(--accent)}
.ai-switch input:checked+.ai-track::after{transform:translateX(15px)}
.ai-switch input:focus-visible+.ai-track{box-shadow:var(--ring)}
.ai-current{display:flex;align-items:center;gap:.5rem;font-size:.8rem}
.ai-select{border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.35rem .6rem;font-size:.8rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit;max-width:230px;cursor:pointer}
.ai-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}

.ai-test__flow{display:flex;flex-direction:column;gap:.85rem}
.ai-tip{display:flex;gap:.55rem;padding:.75rem .85rem;border-radius:9px;background:var(--accent-soft);color:var(--accent-text);font-size:.78rem;line-height:1.55}
.ai-tip svg{flex-shrink:0;margin-top:.05rem}
.ai-field{display:flex;flex-direction:column;gap:.4rem}
.ai-label{font-size:.78rem;font-weight:620;color:var(--theme-elevation-700)}
html.dark .ai-label{color:var(--theme-elevation-300)}
.ai-input,.ai-test-select{width:100%;box-sizing:border-box;border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.55rem .7rem;font-size:.85rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit}
.ai-input:focus,.ai-test-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.ai-result{margin-top:.2rem;border:1px solid var(--theme-elevation-200);border-radius:10px;overflow:hidden;background:var(--theme-elevation-50)}
.ai-result__head{display:flex;align-items:center;gap:.45rem;padding:.55rem .8rem;background:var(--theme-elevation-100);font-size:.74rem;color:var(--theme-elevation-600);border-bottom:1px solid var(--theme-elevation-200)}
html.dark .ai-result__head{color:var(--theme-elevation-300)}
.ai-result__body{padding:.85rem .9rem;font-size:.86rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:0}
.ai-result--err{border-color:var(--danger)}
.ai-result--err .ai-result__head{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
@media(prefers-reduced-motion:reduce){.ai-btn,.ai-card,.ai-track,.ai-track::after{transition:none}}
`
