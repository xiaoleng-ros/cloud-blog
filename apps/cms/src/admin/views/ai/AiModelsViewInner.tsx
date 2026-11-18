'use client'

/**
 * AI 模型管理主体 —— 遵循后台 Cool Azure 主题变量，自动跟随明暗。
 * 交互：选内置平台 → 填 Key → 选模型；右侧对话式测试。
 */
import React, { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { useToast, Toast } from '../../components/Toast'
import { ShellIcon } from '../../shell/icons'

type PresetModel = { id: string; name: string; free?: boolean; note?: string }
type Preset = { id: string; name: string; short: string; color: string; baseURL: string; keyUrl: string; docs: string; models: PresetModel[]; defaultModel: string }
type Provider = {
  index: number; platformId: string; platformName: string; keyUrl: string; docs: string; baseURL: string; short: string; color: string;
  availableModels: PresetModel[]; apiKeyMasked: string; modelId: string; enabled: boolean; allowFrontend: boolean
}
type TestResult = { content: string; model: string; usage?: unknown; latencyMs?: number } | null

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || '请求失败')
  return data as T
}

const EyeIcon = ({ open }: { open: boolean }) => open
  ? <><path d='M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z'/><circle cx='12' cy='12' r='3'/></>
  : <><path d='M3 3l18 18'/><path d='M10.6 6.2A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.5M6.2 6.2C3.6 7.9 2 12 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4-.9'/></>

export function AiModelsViewInner() {
  const { toast, show } = useToast()
  const [presets, setPresets] = useState<Preset[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({})
  const [testPlatform, setTestPlatform] = useState('')
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

  const addProvider = () => {
    const p = presets[0]
    if (!p) return
    setProviders((prev) => [...prev, { index: prev.length, platformId: p.id, platformName: p.name, keyUrl: p.keyUrl, docs: p.docs, baseURL: p.baseURL, short: p.short, color: p.color, availableModels: p.models, apiKeyMasked: '', modelId: p.defaultModel, enabled: true, allowFrontend: false }])
    setDirty(true)
  }
  const changePlatform = (i: number, platformId: string) => {
    const p = presets.find((x) => x.id === platformId)
    if (!p) return
    setProviders((prev) => prev.map((x, idx) => idx === i ? { ...x, platformId, platformName: p.name, keyUrl: p.keyUrl, docs: p.docs, baseURL: p.baseURL, short: p.short, color: p.color, availableModels: p.models, modelId: p.defaultModel } : x))
    setDirty(true)
  }
  const update = (i: number, patch: Partial<Provider>) => {
    setProviders((prev) => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
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
        body: JSON.stringify({ providers: providers.map((p) => ({ ...p, apiKey: p.apiKeyMasked })) }),
      })
      setProviders(data.providers)
      setTestPlatform(data.providers[0]?.platformId || '')
      setDirty(false)
      show('success', '保存成功')
    } catch (e) { show('error', '保存失败：' + (e as Error).message) }
    finally { setSaving(false) }
  }

  const runTest = async () => {
    if (!testPlatform) { show('error', '请先添加并保存一个平台'); return }
    setTesting(true); setTestResult(null); setTestError('')
    try {
      const data = await api<TestResult>('/api/admin/ai-models', {
        method: 'POST',
        body: JSON.stringify({ platformId: testPlatform, prompt: testPrompt }),
      })
      setTestResult(data)
    } catch (e) { setTestError((e as Error).message) }
    finally { setTesting(false) }
  }

  const configuredCount = providers.filter((p) => p.apiKeyMasked).length

  return (
    <div className="ai-page">
      <style>{AI_CSS}</style>
      <Toast toast={toast} />

      <div className="ai-head">
        <div>
          <h1 className="ai-head__title">AI 模型</h1>
          <p className="ai-head__desc">选择内置平台、填入 API Key 即可使用。接口地址与模型列表已内置，Key 只在服务端保存与调用。</p>
        </div>
        <button className="ai-btn ai-btn--primary" onClick={save} disabled={!dirty || saving}>
          {saving ? '保存中…' : dirty ? '保存更改' : '已保存'}
        </button>
      </div>

      <div className="ai-layout">
        <section className="ai-panel">
          <div className="ai-panel__head">
            <div>
              <h2 className="ai-panel__title"><ShellIcon name='ai' size={18} /> 已配置平台</h2>
              <p className="ai-panel__sub">{configuredCount > 0 ? `已配置 ${configuredCount} 个平台` : '添加第一个平台开始使用'}</p>
            </div>
            <button className="ai-btn ai-btn--ghost ai-btn--sm" onClick={addProvider} disabled={!presets.length}>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><path d='M12 5v14M5 12h14'/></svg> 添加平台
            </button>
          </div>
          <div className="ai-panel__body">
            {loading ? (
              <div className="ai-empty"><p className="ai-empty__desc">加载中…</p></div>
            ) : providers.length === 0 ? (
              <div className="ai-empty">
                <div className="ai-empty__icon"><ShellIcon name='ai' size={28} /></div>
                <p className="ai-empty__title">还没有配置平台</p>
                <p className="ai-empty__desc">点「添加平台」，选择硅基流动、智谱 GLM 等内置平台，填入 API Key 就能调用。想省事的话，硅基流动和智谱都有免费模型。</p>
                <button className="ai-btn ai-btn--primary" onClick={addProvider}>+ 添加第一个平台</button>
              </div>
            ) : providers.map((p, i) => {
              const hasKey = Boolean(p.apiKeyMasked)
              const keyVisible = Boolean(showKeys[i])
              return (
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
                    <button className="ai-card__del" title='删除此平台' aria-label='删除此平台' onClick={() => remove(i)}>
                      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round'><path d='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'/></svg>
                    </button>
                  </div>

                  <div className="ai-grid">
                    <div className="ai-field">
                      <label className="ai-field__label"><span>API Key</span>{p.keyUrl && <a className="ai-link" href={p.keyUrl} target='_blank' rel='noreferrer'>去获取 <span aria-hidden='true'>↗</span></a>}</label>
                      <div className="ai-key-wrap">
                        <input className="ai-input" type={keyVisible ? 'text' : 'password'} autoComplete='off' spellCheck={false}
                          aria-label={`${p.platformName} 的 API Key`}
                          placeholder={hasKey ? '留空则不修改，输入即替换' : '粘贴 API Key'}
                          value={keyVisible ? (p.apiKeyMasked.includes('••') ? '' : p.apiKeyMasked) : (p.apiKeyMasked.includes('••') ? '' : p.apiKeyMasked)}
                          onChange={(e) => update(i, { apiKeyMasked: e.target.value })} />
                        <button type='button' className="ai-eye" title={keyVisible ? '隐藏' : '显示'} aria-label={keyVisible ? '隐藏 Key' : '显示 Key'}
                          onClick={() => setShowKeys((s) => ({ ...s, [i]: !s[i] }))}>
                          <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'><EyeIcon open={keyVisible} /></svg>
                        </button>
                      </div>
                      {hasKey && <span className="ai-hintline">当前已保存：{p.apiKeyMasked}</span>}
                    </div>
                    <div className="ai-field">
                      <label className="ai-field__label" htmlFor={`model-${i}`}><span>使用模型</span></label>
                      <select id={`model-${i}`} className="ai-select" value={p.modelId} onChange={(e) => update(i, { modelId: e.target.value })}>
                        {p.availableModels.map((m) => (
                          <option value={m.id} key={m.id}>{m.name}{m.free ? ' · 免费' : ''}</option>
                        ))}
                      </select>
                      {p.docs && <span className="ai-hintline">模型是否免费以平台当前政策为准 · <a className="ai-link" href={p.docs} target='_blank' rel='noreferrer'>文档</a></span>}
                    </div>
                  </div>

                  <div className="ai-card__foot">
                    <label className="ai-switch">
                      <input type='checkbox' checked={p.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                      <span className="ai-track" aria-hidden='true' /> 启用此平台
                    </label>
                    <label className="ai-switch">
                      <input type='checkbox' checked={p.allowFrontend} onChange={(e) => update(i, { allowFrontend: e.target.checked })} />
                      <span className="ai-track" aria-hidden='true' /> 允许前台功能调用（会产生额度消耗）
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="ai-panel ai-test">
          <div className="ai-panel__head">
            <h2 className="ai-panel__title">
              <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/></svg> 在线测试
            </h2>
          </div>
          <div className="ai-panel__body">
            <div className="ai-test__flow">
              <div className="ai-tip">
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8h.01'/></svg>
                <span>先保存配置，再在这里发一条消息，验证 Key 是否可用。测试不会对外公开。</span>
              </div>
              <div className="ai-field">
                <label className="ai-field__label"><span>平台</span></label>
                <select className="ai-select" value={testPlatform} onChange={(e) => setTestPlatform(e.target.value)} disabled={!providers.length}>
                  {providers.map((p, i) => <option value={p.platformId} key={i}>{p.platformName}</option>)}
                </select>
              </div>
              <div className="ai-field">
                <label className="ai-field__label" htmlFor='ai-prompt'><span>提示词</span></label>
                <textarea id='ai-prompt' className="ai-input" rows={4} value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
              </div>
              <button className="ai-btn ai-btn--primary" onClick={runTest} disabled={testing || !testPlatform}>
                {testing ? '调用中…' : '发送测试'}
              </button>
              {testError && (
                <div className="ai-result ai-result--err">
                  <div className="ai-result__head"><ShellIcon name='close' size={13} /> 调用失败</div>
                  <pre className="ai-result__body">{testError}</pre>
                </div>
              )}
              {testResult && (
                <div className="ai-result">
                  <div className="ai-result__head"><ShellIcon name='ai' size={13} /> {testResult.model}{testResult.latencyMs != null ? ` · ${(testResult.latencyMs / 1000).toFixed(1)}s` : ''}</div>
                  <pre className="ai-result__body">{testResult.content || '（空回复）'}</pre>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/** 组件内样式：ai- 前缀，全部走后台主题变量 */
const AI_CSS = `
/* AI 模型管理 · 遵循后台 Cool Azure 主题变量，自动跟随明暗 */
.ai-page{padding:0 0 2.5rem;max-width:1180px}
.ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
.ai-head__title{font-size:1.3rem;font-weight:650;letter-spacing:.01em;margin:0 0 .25rem}
.ai-head__desc{font-size:.85rem;color:var(--theme-elevation-500);margin:0;line-height:1.55}

.ai-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,1fr);gap:1.15rem;align-items:start}
@media(max-width:1000px){.ai-layout{grid-template-columns:1fr}}

.ai-panel{background:var(--theme-elevation-0);border:var(--card-line);border-radius:var(--card-radius);overflow:hidden}
.ai-panel__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.35rem;border-bottom:1px solid var(--theme-elevation-150);background:var(--theme-elevation-50)}
.ai-panel__title{display:flex;align-items:center;gap:.6rem;font-size:.98rem;font-weight:620;margin:0}
.ai-panel__title svg{color:var(--accent)}
.ai-panel__sub{font-size:.78rem;color:var(--theme-elevation-500);margin:.25rem 0 0}
.ai-panel__body{padding:1.25rem 1.35rem}

/* 按钮 */
.ai-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.55rem 1rem;font-size:.85rem;font-weight:550;cursor:pointer;background:var(--theme-elevation-0);color:var(--theme-text);font-family:inherit;transition:background 140ms ease,border-color 140ms ease,box-shadow 140ms ease,transform 100ms ease;white-space:nowrap}
.ai-btn:hover{border-color:var(--accent);color:var(--accent-text)}
.ai-btn:active{transform:translateY(1px)}
.ai-btn:focus-visible{outline:none;box-shadow:var(--ring);border-color:var(--accent)}
.ai-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.ai-btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.ai-btn--primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
.ai-btn--ghost{background:transparent}
.ai-btn--sm{padding:.35rem .7rem;font-size:.8rem}

/* 空状态 */
.ai-empty{padding:3rem 1.5rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.5rem}
.ai-empty__icon{width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent-text);margin-bottom:.4rem}
.ai-empty__title{font-size:1rem;font-weight:620;margin:0}
.ai-empty__desc{font-size:.85rem;color:var(--theme-elevation-500);margin:0 0 1rem;max-width:380px;line-height:1.6}

/* 平台卡片 */
.ai-card{position:relative;border:1px solid var(--theme-elevation-200);border-radius:11px;padding:1.1rem 1.15rem;margin-bottom:1rem;background:var(--theme-elevation-0);transition:border-color 160ms ease,box-shadow 160ms ease}
.ai-card:hover{border-color:var(--theme-elevation-300)}
.ai-card:focus-within{border-color:var(--accent);box-shadow:var(--ring)}
.ai-card--off{opacity:.72;background:var(--theme-elevation-50)}
.ai-card__top{display:flex;align-items:center;gap:.75rem;margin-bottom:1rem}
.ai-brand{width:42px;height:42px;flex-shrink:0;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.9rem;letter-spacing:.02em;box-shadow:0 2px 6px rgb(20 27 38 / .14)}
.ai-card__meta{flex:1;min-width:0}
.ai-card__name{font-size:.95rem;font-weight:620;margin:0 0 .2rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.ai-card__url{font-size:.74rem;color:var(--theme-elevation-500);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-badge{display:inline-flex;align-items:center;gap:.25rem;font-size:.68rem;font-weight:600;padding:.15rem .5rem;border-radius:20px;line-height:1.6}
.ai-badge--on{background:var(--accent-soft);color:var(--accent-text)}
.ai-badge--off{background:var(--theme-elevation-150);color:var(--theme-elevation-500)}
.ai-badge--front{background:#e6f7ee;color:#0a7a44}
html.dark .ai-badge--front{background:#123328;color:#5fd39a}
.ai-card__del{border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.35rem;border-radius:7px;display:flex;transition:background 140ms ease,color 140ms ease}
.ai-card__del:hover{background:var(--danger-soft);color:var(--danger)}
.ai-card__del:focus-visible{outline:none;box-shadow:var(--ring)}

.ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
@media(max-width:620px){.ai-grid{grid-template-columns:1fr}}
.ai-field{display:flex;flex-direction:column;gap:.4rem;min-width:0}
.ai-field__label{font-size:.78rem;font-weight:600;color:var(--theme-elevation-700);display:flex;align-items:center;justify-content:space-between;gap:.5rem}
html.dark .ai-field__label{color:var(--theme-elevation-300)}
.ai-link{font-size:.74rem;font-weight:550;color:var(--accent-text);text-decoration:none;display:inline-flex;align-items:center;gap:.2rem}
.ai-link:hover{text-decoration:underline}
.ai-input,.ai-select{width:100%;box-sizing:border-box;border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.55rem .7rem;font-size:.85rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit;transition:border-color 140ms ease,box-shadow 140ms ease}
.ai-input::placeholder{color:var(--theme-elevation-400)}
.ai-input:focus,.ai-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.ai-select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237c8ba3' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .7rem center;padding-right:2rem;cursor:pointer}
.ai-key-wrap{position:relative}
.ai-key-wrap .ai-input{padding-right:2.4rem}
.ai-eye{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.35rem;border-radius:6px;display:flex}
.ai-eye:hover{color:var(--accent-text)}
.ai-eye:focus-visible{outline:none;box-shadow:var(--ring)}
.ai-hintline{font-size:.72rem;color:var(--theme-elevation-500);margin-top:.15rem}

.ai-card__foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem;padding-top:.85rem;border-top:1px dashed var(--theme-elevation-200);flex-wrap:wrap}
.ai-switch{display:inline-flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--theme-elevation-600);cursor:pointer;user-select:none}
html.dark .ai-switch{color:var(--theme-elevation-300)}
.ai-switch input{position:absolute;opacity:0;width:0;height:0}
.ai-track{width:34px;height:19px;border-radius:20px;background:var(--theme-elevation-250);position:relative;transition:background 160ms ease;flex-shrink:0}
.ai-track::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .2);transition:transform 160ms ease}
.ai-switch input:checked+.ai-track{background:var(--accent)}
.ai-switch input:checked+.ai-track::after{transform:translateX(15px)}
.ai-switch input:focus-visible+.ai-track{box-shadow:var(--ring)}

/* 测试面板 */
.ai-test{position:sticky;top:1rem}
.ai-test__flow{display:flex;flex-direction:column;gap:.85rem}
.ai-result{margin-top:.2rem;border:1px solid var(--theme-elevation-200);border-radius:10px;overflow:hidden;background:var(--theme-elevation-50)}
.ai-result__head{display:flex;align-items:center;gap:.45rem;padding:.55rem .8rem;background:var(--theme-elevation-100);font-size:.74rem;color:var(--theme-elevation-600);border-bottom:1px solid var(--theme-elevation-200)}
html.dark .ai-result__head{color:var(--theme-elevation-300)}
.ai-result__body{padding:.85rem .9rem;font-size:.86rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:0}
.ai-result--err{border-color:var(--danger)}
.ai-result--err .ai-result__head{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
.ai-tip{display:flex;gap:.55rem;padding:.75rem .85rem;border-radius:9px;background:var(--accent-soft);color:var(--accent-text);font-size:.78rem;line-height:1.55}
.ai-tip svg{flex-shrink:0;margin-top:.05rem}

@media(prefers-reduced-motion:reduce){.ai-btn,.ai-card,.ai-track,.ai-track::after{transition:none}}
`
