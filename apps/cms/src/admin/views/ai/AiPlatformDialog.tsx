'use client'

/**
 * AI 平台配置弹窗：选平台 → 填 Key → 拉取该账号可用模型 → 单选/多选 → 确认。
 * createPortal 挂 body；Esc / 点遮罩关闭；打开时锁背景滚动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ShellIcon } from '../../shell/icons'

export interface AiPresetOption { id: string; name: string; short: string; color: string; keyUrl: string; baseURL: string }
export interface AiDialogValue { platformId: string; apiKey: string; modelIds: string[] }

interface Props {
  open: boolean
  presets: AiPresetOption[]
  initial: AiDialogValue | null
  onClose: () => void
  onConfirm: (value: AiDialogValue) => void
}

type RemoteModel = { id: string; name: string }

export function AiPlatformDialog({ open, presets, initial, onClose, onConfirm }: Props) {
  const [platformId, setPlatformId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<RemoteModel[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)
  const preset = presets.find((p) => p.id === platformId)

  useEffect(() => {
    if (!open) return
    const pid = initial?.platformId || presets[0]?.id || ''
    setPlatformId(pid)
    setApiKey(initial?.apiKey || '')
    setSelected(initial?.modelIds ?? [])
    setModels((initial?.modelIds ?? []).map((id) => ({ id, name: id })))
    setFetched(Boolean(initial?.modelIds?.length))
    setError('')
    const timer = window.setTimeout(() => keyRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, initial, presets])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  const changePlatform = (id: string) => {
    setPlatformId(id); setModels([]); setSelected([]); setFetched(false); setError('')
  }

  const fetchModels = useCallback(async () => {
    if (!platformId) { setError('请选择平台'); return }
    if (!apiKey.trim()) { setError('请先填写 API Key'); return }
    setLoading(true); setError(''); setFetched(false)
    try {
      const res = await fetch('/api/admin/ai-models/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformId, apiKey: apiKey.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || '拉取失败')
      const list = (data as { models: RemoteModel[] }).models || []
      setModels(list); setSelected([]); setFetched(true)
      if (!list.length) setError('该账号没有返回可用模型，请检查 Key 是否正确')
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [platformId, apiKey])

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const confirm = () => {
    if (!apiKey.trim()) { setError('请填写 API Key'); return }
    if (!selected.length) { setError('请至少选择一个模型（可多选）'); return }
    onConfirm({ platformId, apiKey: apiKey.trim(), modelIds: selected })
  }

  if (!open) return null

  return createPortal(
    <div className="aid-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aid" role="dialog" aria-modal="true" aria-labelledby="aid-title">
        <header className="aid__head">
          <div>
            <h2 className="aid__title" id="aid-title">{initial ? '编辑平台' : '添加平台'}</h2>
            <p className="aid__sub">选平台、填 Key，拉取该账号可用的模型后选择（可多选）。</p>
          </div>
          <button className="aid__x" aria-label="关闭" onClick={onClose}><ShellIcon name="close" size={18} /></button>
        </header>
        <div className="aid__body">
          <div className="aid__field">
            <label className="aid__label" htmlFor="aid-platform">平台</label>
            <select id="aid-platform" className="aid__select" value={platformId} onChange={(e) => changePlatform(e.target.value)}>
              {presets.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="aid__field">
            <label className="aid__label" htmlFor="aid-key">API Key {preset?.keyUrl && <a className="aid__link" href={preset.keyUrl} target="_blank" rel="noreferrer">去获取 ↗</a>}</label>
            <div className="aid__row">
              <input id="aid-key" ref={keyRef} className="aid__input" type="password" autoComplete="off" spellCheck={false}
                placeholder={initial ? '留空则保持原 Key，输入则替换' : '粘贴 API Key'}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <button className="aid__fetch" onClick={fetchModels} disabled={loading}>{loading ? '拉取中…' : fetched ? '重新拉取' : '拉取模型'}</button>
            </div>
          </div>
          <div className="aid__models">
            <div className="aid__models-head">
              <span className="aid__label">可用模型（可多选）</span>
              <span className="aid__hint">{fetched ? `已选 ${selected.length} / ${models.length}` : '填 Key 后点「拉取模型」'}</span>
            </div>
            {!fetched ? (
              <div className="aid__state">填入 API Key 并点「拉取模型」，即可看到该账号实际可用的模型。</div>
            ) : models.length === 0 ? (
              <div className="aid__state">没有返回模型</div>
            ) : (
              <div className="aid__list">
                {models.map((m) => (
                  <label className="aid__opt" key={m.id}>
                    <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                    <span>{m.name}</span>
                    <span className="aid__opt-id" title={m.id}>{m.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {error && <div className="aid__error">{error}</div>}
        </div>
        <footer className="aid__foot">
          <span className="aid__count">共选择 {selected.length} 个模型</span>
          <div className="aid__actions">
            <button className="aid__btn" onClick={onClose}>取消</button>
            <button className="aid__btn aid__btn--primary" onClick={confirm} disabled={loading}>确认使用</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}

/** 弹窗样式：ai- 前缀区分，全部走后台主题变量 */
const DIALOG_CSS = `
/* AI 平台配置弹窗 · 走后台主题变量 */
.aid-mask{position:fixed;inset:0;z-index:100000;background:rgb(20 27 38 / .45);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:1rem}
.aid{width:min(560px,100%);max-height:90vh;overflow:auto;background:var(--theme-elevation-0);border:1px solid var(--theme-elevation-200);border-radius:14px;box-shadow:var(--shadow-popup);animation:aid-in 160ms ease}
@keyframes aid-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
.aid__head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.15rem 1.35rem;border-bottom:1px solid var(--theme-elevation-150)}
.aid__title{font-size:1.05rem;font-weight:640;margin:0 0 .25rem}
.aid__sub{font-size:.8rem;color:var(--theme-elevation-500);margin:0;line-height:1.5}
.aid__x{border:none;background:transparent;color:var(--theme-elevation-400);cursor:pointer;padding:.3rem;border-radius:7px;display:flex}
.aid__x:hover{background:var(--danger-soft);color:var(--danger)}
.aid__x:focus-visible{outline:none;box-shadow:var(--ring)}
.aid__body{padding:1.25rem 1.35rem;display:flex;flex-direction:column;gap:1rem}
.aid__field{display:flex;flex-direction:column;gap:.4rem}
.aid__label{font-size:.8rem;font-weight:620;color:var(--theme-elevation-700)}
html.dark .aid__label{color:var(--theme-elevation-300)}
.aid__row{display:flex;gap:.6rem;align-items:flex-end}
.aid__row>*:first-child{flex:1}
.aid__input,.aid__select{width:100%;box-sizing:border-box;border:1px solid var(--theme-elevation-250);border-radius:7px;padding:.55rem .7rem;font-size:.85rem;background:var(--theme-input-bg);color:var(--theme-text);font-family:inherit}
.aid__input:focus,.aid__select:focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.aid__link{font-size:.75rem;color:var(--accent-text);text-decoration:none}
.aid__link:hover{text-decoration:underline}
.aid__fetch{border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent-text);border-radius:7px;padding:.55rem .85rem;font-size:.82rem;font-weight:550;cursor:pointer;white-space:nowrap;font-family:inherit}
.aid__fetch:hover{background:var(--accent);color:#fff}
.aid__fetch:disabled{opacity:.55;cursor:not-allowed}
.aid__fetch:focus-visible{outline:none;box-shadow:var(--ring)}
.aid__models{margin-top:.2rem}
.aid__models-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
.aid__hint{font-size:.75rem;color:var(--theme-elevation-500)}
.aid__list{border:1px solid var(--theme-elevation-200);border-radius:9px;max-height:230px;overflow:auto;background:var(--theme-elevation-50)}
.aid__opt{display:flex;align-items:center;gap:.65rem;padding:.6rem .75rem;cursor:pointer;border-bottom:1px solid var(--theme-elevation-150);font-size:.85rem;transition:background 120ms ease}
.aid__opt:last-child{border-bottom:none}
.aid__opt:hover{background:var(--accent-soft)}
.aid__opt input{accent-color:var(--accent);width:15px;height:15px;cursor:pointer;flex-shrink:0}
.aid__opt-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--theme-elevation-500);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%}
.aid__state{padding:1.4rem;text-align:center;font-size:.83rem;color:var(--theme-elevation-500)}
.aid__error{padding:.7rem .85rem;border-radius:8px;background:var(--danger-soft);color:var(--danger);font-size:.8rem;line-height:1.5}
.aid__foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.35rem;border-top:1px solid var(--theme-elevation-150);background:var(--theme-elevation-50);border-radius:0 0 14px 14px}
.aid__count{font-size:.8rem;color:var(--theme-elevation-500)}
.aid__actions{display:flex;gap:.6rem}
.aid__btn{border:1px solid var(--theme-elevation-250);background:var(--theme-elevation-0);color:var(--theme-text);border-radius:7px;padding:.5rem 1rem;font-size:.84rem;font-weight:550;cursor:pointer;font-family:inherit}
.aid__btn:hover{border-color:var(--accent);color:var(--accent-text)}
.aid__btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.aid__btn--primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
.aid__btn:disabled{opacity:.5;cursor:not-allowed}
.aid__btn:focus-visible{outline:none;box-shadow:var(--ring)}
@media(prefers-reduced-motion:reduce){.aid{animation:none}}
`
