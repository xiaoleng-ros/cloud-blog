'use client'

/**
 * AI 模型管理主体：供应商 / 模型配置 + 在线测试。
 * 所有数据走同源 /api/admin/ai-models，API Key 只显示脱敏掩码。
 */
import React, { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { useToast, Toast } from '../../components/Toast'

type Model = { modelId: string; displayName: string; free: boolean; contextLength: number | null; allowFrontend: boolean }
type Provider = { index: number; name: string; baseURL: string; apiKeyMasked: string; enabled: boolean; models: Model[] }
type TestResult = { content: string; model: string; usage?: unknown; latencyMs?: number } | null

const emptyModel = (): Model => ({ modelId: '', displayName: '', free: true, contextLength: null, allowFrontend: false })
const emptyProvider = (): Provider => ({ index: -1, name: '', baseURL: '', apiKeyMasked: '', enabled: true, models: [emptyModel()] })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || '请求失败')
  return data as T
}

export function AiModelsViewInner() {
  const { toast, show } = useToast()
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testProvider, setTestProvider] = useState(0)
  const [testModel, setTestModel] = useState('')
  const [testPrompt, setTestPrompt] = useState('请回复：连接成功')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>(null)
  const [testError, setTestError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ providers: Provider[] }>('/api/admin/ai-models')
      setProviders(data.providers)
      setDirty(false)
    } catch (e) {
      show('error', '加载失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [show])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const p = providers[testProvider]
    setTestModel(p?.models?.[0]?.modelId || '')
  }, [testProvider, providers])

  const updateProvider = (i: number, patch: Partial<Provider>) => {
    setProviders((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
    setDirty(true)
  }
  const updateModel = (pi: number, mi: number, patch: Partial<Model>) => {
    setProviders((prev) => prev.map((p, idx) => idx === pi
      ? { ...p, models: p.models.map((m, j) => (j === mi ? { ...m, ...patch } : m)) } : p))
    setDirty(true)
  }
  const addProvider = () => { setProviders((prev) => [...prev, { ...emptyProvider(), index: prev.length }]); setDirty(true) }
  const removeProvider = (i: number) => {
    setProviders((prev) => prev.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, index: idx })))
    setDirty(true)
  }
  const addModel = (pi: number) => {
    setProviders((prev) => prev.map((p, idx) => (idx === pi ? { ...p, models: [...p.models, emptyModel()] } : p)))
    setDirty(true)
  }
  const removeModel = (pi: number, mi: number) => {
    setProviders((prev) => prev.map((p, idx) => (idx === pi
      ? { ...p, models: p.models.filter((_, j) => j !== mi) } : p)))
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
      setDirty(false)
      show('success', '保存成功')
    } catch (e) {
      show('error', '保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!testModel) { show('error', '请先选择模型'); return }
    setTesting(true); setTestResult(null); setTestError('')
    try {
      const data = await api<TestResult>('/api/admin/ai-models', {
        method: 'POST',
        body: JSON.stringify({ providerIndex: testProvider, modelId: testModel, prompt: testPrompt }),
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
            <h2>模型供应商</h2>
            <button className="ai-btn ai-btn--ghost" onClick={addProvider}>+ 添加供应商</button>
          </div>
          <p className="ai-hint">只使用 OpenAI 兼容接口：Base URL 填根地址（如 https://api.siliconflow.cn/v1），系统自动拼接 /chat/completions。API Key 仅存服务端。</p>

          {loading ? <div className="ai-empty">加载中…</div> : providers.length === 0 ? (
            <div className="ai-empty">还没有供应商，点「添加供应商」开始配置。</div>
          ) : providers.map((p, pi) => (
            <div className="ai-provider" key={pi}>
              <div className="ai-provider__top">
                <span className="ai-provider__idx">{pi + 1}</span>
                <input className="ai-input" placeholder="名称（如 硅基流动）" value={p.name}
                  onChange={(e) => updateProvider(pi, { name: e.target.value })} />
                <label className="ai-check">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => updateProvider(pi, { enabled: e.target.checked })} /> 启用
                </label>
                <button className="ai-icon-btn ai-icon-btn--danger" title="删除供应商" onClick={() => removeProvider(pi)}>×</button>
              </div>
              <div className="ai-field">
                <label>Base URL</label>
                <input className="ai-input" placeholder="https://api.siliconflow.cn/v1" value={p.baseURL}
                  onChange={(e) => updateProvider(pi, { baseURL: e.target.value })} />
              </div>
              <div className="ai-field">
                <label>API Key{p.apiKeyMasked && <span className="ai-mask">（当前：{p.apiKeyMasked}，保持掩码则不修改）</span>}</label>
                <input className="ai-input" type="password" autoComplete="off" placeholder={p.apiKeyMasked ? '输入新 Key 以替换' : '粘贴 API Key'}
                  value={p.apiKeyMasked.includes('••') ? '' : p.apiKeyMasked}
                  onChange={(e) => updateProvider(pi, { apiKeyMasked: e.target.value })} />
              </div>
              <div className="ai-models">
                <div className="ai-models__head">
                  <span>可用模型</span>
                  <button className="ai-btn ai-btn--ghost ai-btn--sm" onClick={() => addModel(pi)}>+ 添加模型</button>
                </div>
                {p.models.map((m, mi) => (
                  <div className="ai-model-row" key={mi}>
                    <input className="ai-input" placeholder="模型 ID（如 Qwen/Qwen2.5-7B-Instruct）" value={m.modelId}
                      onChange={(e) => updateModel(pi, mi, { modelId: e.target.value })} />
                    <input className="ai-input" placeholder="显示名（可选）" value={m.displayName}
                      onChange={(e) => updateModel(pi, mi, { displayName: e.target.value })} />
                    <label className="ai-check"><input type="checkbox" checked={m.free} onChange={(e) => updateModel(pi, mi, { free: e.target.checked })} /> 免费</label>
                    <label className="ai-check"><input type="checkbox" checked={m.allowFrontend} onChange={(e) => updateModel(pi, mi, { allowFrontend: e.target.checked })} /> 前台可用</label>
                    <button className="ai-icon-btn ai-icon-btn--danger" title="删除模型" onClick={() => removeModel(pi, mi)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="ai-card ai-test">
          <div className="ai-card__head"><h2>在线测试</h2></div>
          <p className="ai-hint">直接调用所选模型，验证 Key 与模型是否可用。测试不对外公开。</p>
          <div className="ai-field">
            <label>供应商</label>
            <select className="ai-input" value={testProvider} onChange={(e) => setTestProvider(Number(e.target.value))}>
              {providers.map((p, i) => <option value={i} key={i}>{p.name || '未命名 ' + (i + 1)}</option>)}
            </select>
          </div>
          <div className="ai-field">
            <label>模型</label>
            <select className="ai-input" value={testModel} onChange={(e) => setTestModel(e.target.value)}>
              {(providers[testProvider]?.models ?? []).filter((m) => m.modelId).map((m, i) => (
                <option value={m.modelId} key={i}>{m.displayName || m.modelId}</option>
              ))}
            </select>
          </div>
          <div className="ai-field">
            <label>提示词</label>
            <textarea className="ai-input ai-textarea" rows={4} value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
          </div>
          <button className="ai-btn ai-btn--primary" onClick={runTest} disabled={testing || !testModel}>
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

/** 组件内样式：ai- 前缀，避免与后台其它页面冲突 */
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
.ai-provider__top{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}
.ai-provider__idx{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:50%;background:var(--theme-elevation-100,#eee);font-size:.8rem;flex-shrink:0}
.ai-provider__top .ai-input{flex:1;min-width:0}
.ai-field{display:flex;flex-direction:column;gap:.3rem;margin-bottom:.7rem}
.ai-field label{font-size:.8rem;font-weight:600}
.ai-mask{font-weight:400;opacity:.6;font-size:.75rem}
.ai-input{border:1px solid var(--border,#d9d9d9);border-radius:7px;padding:.5rem .65rem;font-size:.85rem;background:var(--surface,#fff);color:inherit;font-family:inherit;min-width:0}
.ai-input:focus{outline:2px solid var(--theme-blue-500,#4b9fff);outline-offset:0}
.ai-textarea{resize:vertical;width:100%}
.ai-check{display:inline-flex;align-items:center;gap:.25rem;font-size:.78rem;white-space:nowrap;cursor:pointer}
.ai-models{margin-top:.8rem;border-top:1px dashed var(--border,#ddd);padding-top:.7rem}
.ai-models__head{display:flex;align-items:center;justify-content:space-between;font-size:.82rem;font-weight:600;margin-bottom:.5rem}
.ai-model-row{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin-bottom:.45rem}
.ai-model-row .ai-input:first-child{flex:2 1 220px}
.ai-model-row .ai-input:nth-child(2){flex:1 1 120px}
.ai-btn{border:1px solid var(--border,#ccc);border-radius:7px;padding:.5rem .9rem;font-size:.82rem;cursor:pointer;background:var(--surface,#fff);color:inherit;font-family:inherit}
.ai-btn:disabled{opacity:.5;cursor:not-allowed}
.ai-btn--primary{background:var(--theme-blue-500,#2f6fed);border-color:var(--theme-blue-500,#2f6fed);color:#fff}
.ai-btn--ghost{background:transparent}
.ai-btn--sm{padding:.3rem .55rem;font-size:.75rem}
.ai-icon-btn{border:none;background:transparent;font-size:1.2rem;line-height:1;cursor:pointer;padding:.15rem .4rem;border-radius:6px}
.ai-icon-btn--danger:hover{background:rgba(220,60,60,.12);color:#d33}
.ai-test{position:sticky;top:1rem}
.ai-result{margin-top:1rem;border:1px solid var(--border,#ddd);border-radius:8px;padding:.75rem;background:var(--bg,#fafafa)}
.ai-result--err{border-color:#e0a0a0;color:#c33}
.ai-result__meta{font-size:.75rem;opacity:.65;margin-bottom:.5rem}
.ai-result__body{white-space:pre-wrap;word-break:break-word;font-size:.85rem;margin:0;max-height:320px;overflow:auto}
`
