'use client'

/**
 * AI 模型管理主体：选内置平台 + 填 API Key + 选模型，无需手填地址。
 */
import React, { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { useToast, Toast } from '../../components/Toast'

type PresetModel = { id: string; name: string; free?: boolean; note?: string }
type Preset = { id: string; name: string; baseURL: string; keyUrl: string; docs: string; models: PresetModel[]; defaultModel: string }
type Provider = {
  index: number; platformId: string; platformName: string; keyUrl: string; docs: string;
  availableModels: PresetModel[]; apiKeyMasked: string; modelId: string; enabled: boolean; allowFrontend: boolean
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
  const [testPlatform, setTestPlatform] = useState('')
  const [testPrompt, setTestPrompt] = useState('请回复：连接成功')
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
    } catch (e) {
      show('error', '加载失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [show])

  useEffect(() => { load() }, [load])

  const addProvider = () => {
    const preset = presets[0]
    if (!preset) return
    setProviders((prev) => [...prev, {
      index: prev.length,
      platformId: preset.id, platformName: preset.name, keyUrl: preset.keyUrl, docs: preset.docs,
      availableModels: preset.models, apiKeyMasked: '', modelId: preset.defaultModel,
      enabled: true, allowFrontend: false,
    }])
    setDirty(true)
  }

  const changePlatform = (i: number, platformId: string) => {
    const preset = presets.find((p) => p.id === platformId)
    if (!preset) return
    setProviders((prev) => prev.map((p, idx) => idx === i
      ? { ...p, platformId, platformName: preset.name, keyUrl: preset.keyUrl, docs: preset.docs,
          availableModels: preset.models, modelId: preset.defaultModel } : p))
    setDirty(true)
  }

  const updateProvider = (i: number, patch: Partial<Provider>) => {
    setProviders((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
    setDirty(true)
  }
  const removeProvider = (i: number) => {
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
    } catch (e) {
      show('error', '保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!testPlatform) { show('error', '请先配置并选择一个平台'); return }
    setTesting(true); setTestResult(null); setTestError('')
    try {
      const data = await api<TestResult>('/api/admin/ai-models', {
        method: 'POST',
        body: JSON.stringify({ platformId: testPlatform, prompt: testPrompt }),
      })
      setTestResult(data)
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="ai-page">
      <style>{AI_CSS}</style>
      <Toast toast={toast} />
      <PageHeader title="AI 模型" actions={(
        <button className="ai-btn ai-btn--primary" onClick={save} disabled={!dirty || saving}>
          {saving ? '保存中…' : dirty ? '保存更改' : '已保存'}
        </button>
      )} />

      <div className="ai-layout">
        <section className="ai-card">
          <div className="ai-card__head">
            <h2>已配置平台</h2>
            <button className="ai-btn ai-btn--ghost" onClick={addProvider}>+ 添加平台</button>
          </div>
          <p className="ai-hint">选平台 → 填该平台 API Key → 选模型，接口地址与模型列表已内置。Key 只存服务端。免费额度以各平台当前政策为准。</p>

          {loading ? <div className="ai-empty">加载中…</div> : providers.length === 0 ? (
            <div className="ai-empty">还没有配置，点「添加平台」开始。</div>
          ) : providers.map((p, i) => (
            <div className="ai-provider" key={i}>
              <div className="ai-provider__top">
                <span className="ai-provider__idx">{i + 1}</span>
                <select className="ai-input ai-platform-select" value={p.platformId}
                  onChange={(e) => changePlatform(i, e.target.value)}>
                  {presets.map((ps) => <option value={ps.id} key={ps.id}>{ps.name}</option>)}
                </select>
                <label className="ai-check"><input type="checkbox" checked={p.enabled}
                  onChange={(e) => updateProvider(i, { enabled: e.target.checked })} /> 启用</label>
                <button className="ai-icon-btn ai-icon-btn--danger" title="删除" onClick={() => removeProvider(i)}>×</button>
              </div>
              <div className="ai-row">
                <div className="ai-field ai-field--grow">
                  <label>API Key{p.keyUrl && <a className="ai-link" href={p.keyUrl} target="_blank" rel="noreferrer">去获取 Key ↗</a>}</label>
                  <input className="ai-input" type="password" autoComplete="off"
                    placeholder={p.apiKeyMasked ? '保持掩码则不修改，输入新 Key 覆盖' : '粘贴 API Key'}
                    value={p.apiKeyMasked.includes('••') ? '' : p.apiKeyMasked}
                    onChange={(e) => updateProvider(i, { apiKeyMasked: e.target.value })} />
                  {p.apiKeyMasked && <span className="ai-mask">当前：{p.apiKeyMasked}</span>}
                </div>
                <div className="ai-field ai-field--grow">
                  <label>使用模型</label>
                  <select className="ai-input" value={p.modelId} onChange={(e) => updateProvider(i, { modelId: e.target.value })}>
                    {p.availableModels.map((m) => (
                      <option value={m.id} key={m.id}>{m.name}{m.free ? '（免费）' : ''}{m.note ? ' · ' + m.note : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="ai-provider__foot">
                <label className="ai-check"><input type="checkbox" checked={p.allowFrontend}
                  onChange={(e) => updateProvider(i, { allowFrontend: e.target.checked })} /> 允许前台功能调用（会产生额度消耗）</label>
                {p.docs && <a className="ai-link" href={p.docs} target="_blank" rel="noreferrer">文档 ↗</a>}
              </div>
            </div>
          ))}
        </section>

        <section className="ai-card ai-test">
          <div className="ai-card__head"><h2>在线测试</h2></div>
          <p className="ai-hint">用已配置的平台直接发一条消息，验证 Key 是否可用。</p>
          <div className="ai-field">
            <label>平台</label>
            <select className="ai-input" value={testPlatform} onChange={(e) => setTestPlatform(e.target.value)}>
              {providers.map((p, i) => <option value={p.platformId} key={i}>{p.platformName}</option>)}
            </select>
          </div>
          <div className="ai-field">
            <label>提示词</label>
            <textarea className="ai-input ai-textarea" rows={4} value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
          </div>
          <button className="ai-btn ai-btn--primary" onClick={runTest} disabled={testing || !testPlatform}>
            {testing ? '调用中…' : '发送测试'}
          </button>
          {testError && <div className="ai-result ai-result--err">{testError}</div>}
          {testResult && (
            <div className="ai-result">
              <div className="ai-result__meta">模型：{testResult.model}{testResult.latencyMs != null ? ' · 耗时 ' + testResult.latencyMs + 'ms' : ''}</div>
              <pre className="ai-result__body">{testResult.content || '（空回复）'}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** 组件内样式：ai- 前缀 */
const AI_CSS = `
.ai-page{padding:0 0 2rem}
.ai-layout{display:grid;grid-template-columns:minmax(0,3fr) minmax(280px,2fr);gap:1.25rem;align-items:start}
@media(max-width:1100px){.ai-layout{grid-template-columns:1fr}}
.ai-card{background:var(--surface,#fff);border:1px solid var(--border,#e2e2e2);border-radius:12px;padding:1.25rem}
.ai-card__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.5rem}
.ai-card__head h2{margin:0;font-size:1.05rem}
.ai-hint{font-size:.8rem;opacity:.7;margin:.25rem 0 1rem;line-height:1.5}
.ai-empty{padding:2rem;text-align:center;opacity:.6}
.ai-provider{border:1px solid var(--border,#e5e5e5);border-radius:10px;padding:1rem;margin-bottom:1rem;background:var(--bg,#fafafa)}
.ai-provider__top{display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem}
.ai-provider__idx{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:50%;background:var(--theme-elevation-100,#eee);font-size:.8rem;flex-shrink:0}
.ai-platform-select{flex:1;min-width:0}
.ai-row{display:flex;gap:1rem;flex-wrap:wrap}
.ai-field{display:flex;flex-direction:column;gap:.3rem;margin-bottom:.7rem}
.ai-field--grow{flex:1 1 240px}
.ai-field label{font-size:.8rem;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.ai-mask{font-weight:400;opacity:.6;font-size:.72rem}
.ai-input{border:1px solid var(--border,#d9d9d9);border-radius:7px;padding:.5rem .65rem;font-size:.85rem;background:var(--surface,#fff);color:inherit;font-family:inherit;min-width:0;width:100%}
.ai-input:focus{outline:2px solid var(--theme-blue-500,#4b9fff);outline-offset:0}
.ai-textarea{resize:vertical;width:100%}
.ai-check{display:inline-flex;align-items:center;gap:.25rem;font-size:.78rem;white-space:nowrap;cursor:pointer}
.ai-provider__foot{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:.3rem;flex-wrap:wrap}
.ai-btn{border:1px solid var(--border,#ccc);border-radius:7px;padding:.5rem .9rem;font-size:.82rem;cursor:pointer;background:var(--surface,#fff);color:inherit;font-family:inherit}
.ai-btn:disabled{opacity:.5;cursor:not-allowed}
.ai-btn--primary{background:var(--theme-blue-500,#2f6fed);border-color:var(--theme-blue-500,#2f6fed);color:#fff}
.ai-btn--ghost{background:transparent}
.ai-icon-btn{border:none;background:transparent;font-size:1.2rem;line-height:1;cursor:pointer;padding:.15rem .4rem;border-radius:6px}
.ai-icon-btn--danger:hover{background:rgba(220,60,60,.12);color:#d33}
.ai-link{font-size:.75rem;color:var(--theme-blue-500,#2f6fed);text-decoration:none}
.ai-link:hover{text-decoration:underline}
.ai-test{position:sticky;top:1rem}
.ai-result{margin-top:1rem;border:1px solid var(--border,#ddd);border-radius:8px;padding:.75rem;background:var(--bg,#fafafa)}
.ai-result--err{border-color:#e0a0a0;color:#c33}
.ai-result__meta{font-size:.75rem;opacity:.65;margin-bottom:.5rem}
.ai-result__body{white-space:pre-wrap;word-break:break-word;font-size:.85rem;margin:0;max-height:320px;overflow:auto}
`
