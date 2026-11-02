'use client'

/**
 * 友链新建 / 编辑弹窗（卡片式表单）
 *
 * ==================== 为什么不用 Payload 原生编辑页 ====================
 *
 * 原生编辑页是整页跳转：点一下卡片上的「编辑」，当前列表被卸载，
 * 保存后还要手动退回列表，筛选/搜索/滚动位置全丢。友链只有十来个扁平字段，
 * 一枚弹窗就够，而且改完立刻回到列表、就地更新那一张卡片。
 *
 * 字段顺序照后台原生页：主信息在左（名称/地址/描述/头像/备注），
 * 运营信息在右（状态/排序/来源/邮箱/留言）。排序值、状态、来源这些
 * 「填完就忘」的项放右栏，不干扰录入。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { describeApiError } from '../lib/api'
import type { FriendDoc, FriendStatus } from './FriendsViewInner'

type Source = 'manual' | 'apply'

interface FormState {
  name: string
  url: string
  description: string
  avatar: string
  note: string
  sortOrder: string
  status: FriendStatus
  source: Source
  email: string
  message: string
}

const EMPTY_FORM: FormState = {
  name: '',
  url: '',
  description: '',
  avatar: '',
  note: '',
  sortOrder: '0',
  status: 'published',
  source: 'manual',
  email: '',
  message: '',
}

const fromDoc = (doc: FriendDoc): FormState => ({
  name: doc.name ?? '',
  url: doc.url ?? '',
  description: doc.description ?? '',
  avatar: doc.avatar ?? '',
  note: doc.note ?? '',
  sortOrder: String(doc.sortOrder ?? 0),
  status: (String(doc.status ?? 'pending') as FriendStatus) || 'pending',
  source: (doc.source === 'apply' ? 'apply' : 'manual') as Source,
  email: doc.email ?? '',
  message: doc.message ?? '',
})

const initialOf = (name: string) => Array.from(name.trim())[0] ?? '?'

/** 只做「能提前拦住」的那部分校验；协议白名单、唯一约束以后端为准 */
function validate(form: FormState): string | null {
  if (!form.name.trim()) return '站点名称不能为空'
  if (!form.url.trim()) return '站点地址不能为空'
  if (!/^https?:\/\/[^\s]+/i.test(form.url.trim())) {
    return '站点地址必须是 http(s) 开头的完整地址，例如 https://example.com'
  }
  if (form.avatar.trim() && !/^https?:\/\/[^\s]+/i.test(form.avatar.trim())) {
    return '头像地址必须是 http(s) 开头的图片地址，留空则用站名首字'
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return '联系邮箱格式不对'
  }
  return null
}

export interface FriendFormDialogProps {
  /** 挂载开关；关闭时组件仍留在树上，靠 open 控制显隐（保留输入内容，避免误关丢字） */
  open: boolean
  /** null = 新建 */
  initial: FriendDoc | null
  onClose: () => void
  /** doc 为 null = 服务端没回文档（拿不到 id），父组件退回重拉列表 */
  onSaved: (doc: FriendDoc | null, mode: 'create' | 'update') => void
}

export function FriendFormDialog({ open, initial, onClose, onSaved }: FriendFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const isEdit = Boolean(initial)

  // 每次打开都按当前记录重置：新建清空，编辑回填
  useEffect(() => {
    if (!open) return
    setForm(initial ? fromDoc(initial) : EMPTY_FORM)
    setError(null)
  }, [open, initial])

  // Esc 关闭 + 打开期间锁背景滚动
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 让键盘用户进来就能直接打字
    const timer = window.setTimeout(() => nameRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      window.clearTimeout(timer)
    }
  }, [open, onClose])

  const patch = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  )

  const submit = async () => {
    const problem = validate(form)
    if (problem) {
      setError(problem)
      return
    }

    setSaving(true)
    setError(null)
    try {
      /**
       * group 是集合里的必填字段（前台不分组，但没打算删）。
       * 新建时补默认值，编辑时沿用记录原值 —— 自己造一个「朋友们」会把
       * 用户将来分区时录的分组冲掉。
       */
      const body = {
        name: form.name.trim(),
        url: form.url.trim(),
        description: form.description.trim(),
        avatar: form.avatar.trim(),
        note: form.note.trim(),
        sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
        status: form.status,
        source: form.source,
        email: form.email.trim(),
        message: form.message.trim(),
        group: initial?.group ?? '朋友们',
      }

      const endpoint = isEdit ? `/api/friends/${initial!.id}` : '/api/friends'
      const res = await fetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const json = (await res.json()) as { errors?: Array<{ message?: string }> }
          const first = json.errors?.[0]?.message
          if (first) {
            // 唯一索引冲突的原始文案太长，换成人话
            message = /duplicate key|unique/i.test(first)
              ? '这个站点地址已经收录过了，换一个再试'
              : first
          }
        } catch {
          /* 非 JSON 响应保留状态码 */
        }
        throw new Error(message)
      }

      /**
       * Payload 的 create / update 返回 `{ doc, message }`，不是文档本身。
       * 直接当文档用会往列表插一条没有 id 的畸形记录（新建）或保持旧值（编辑）。
       */
      const json = (await res.json()) as { doc?: FriendDoc }
      onSaved(json.doc ?? null, isEdit ? 'update' : 'create')
    } catch (e) {
      setError(describeApiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="friends__dialog-mask"
      onMouseDown={(event) => {
        // 只在点遮罩本身时关；点弹窗内部不关
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div
        className="friends__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-dialog-title"
      >
        <header className="friends__dialog-head">
          <div>
            <h2 className="friends__dialog-title" id="friends-dialog-title">
              {isEdit ? '编辑友链' : '新建友链'}
            </h2>
            <p className="friends__dialog-sub">
              名称、地址、描述和头像决定卡片长什么样，保存后前台立即更新
            </p>
          </div>
          <button
            type="button"
            className="friends__dialog-close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="friends__dialog-body">
          <div className="friends__form-col">
            <label className="friends__form-field">
              <span className="friends__form-label">
                站点名称 <em>*</em>
              </span>
              <input
                ref={nameRef}
                className="friends__form-input"
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="例：纸鹿摸鱼处"
                maxLength={50}
              />
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">
                站点地址 <em>*</em>
              </span>
              <input
                className="friends__form-input"
                value={form.url}
                onChange={(e) => patch('url', e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
              />
              <span className="friends__form-hint">
                必须是 http(s) 开头的完整地址，同一地址不能重复收录
              </span>
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">一句话描述</span>
              <textarea
                className="friends__form-input friends__form-textarea"
                value={form.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="卡片正面那句副标题，建议 30 字以内"
                maxLength={120}
                rows={2}
              />
            </label>

            <div className="friends__form-field">
              <span className="friends__form-label">头像地址</span>
              <div className="friends__form-avatar-row">
                <span className="friends__avatar-preview">
                  <span className="friends__initial" aria-hidden="true">
                    {initialOf(form.name)}
                  </span>
                  {form.avatar.trim() ? (
                    <img
                      src={form.avatar.trim()}
                      alt=""
                      // 填一半的地址会疯狂 404，图挂了就摘掉，露出首字
                      onError={(e) => {
                        ;(e.currentTarget as HTMLImageElement).remove()
                      }}
                    />
                  ) : null}
                </span>
                <input
                  className="friends__form-input"
                  value={form.avatar}
                  onChange={(e) => patch('avatar', e.target.value)}
                  placeholder="https://.../avatar.png"
                  inputMode="url"
                />
              </div>
              <span className="friends__form-hint">留空则用站名首字；对方图床挂了也会自动退回首字</span>
            </div>

            <label className="friends__form-field">
              <span className="friends__form-label">站长备注</span>
              <input
                className="friends__form-input"
                value={form.note}
                onChange={(e) => patch('note', e.target.value)}
                placeholder="只在鼠标悬停时显示，可留空"
                maxLength={120}
              />
            </label>
          </div>

          <div className="friends__form-col friends__form-col--side">
            <label className="friends__form-field">
              <span className="friends__form-label">状态</span>
              <select
                className="friends__form-input"
                value={form.status}
                onChange={(e) => patch('status', e.target.value as FriendStatus)}
              >
                {/**
                 * 不提供「已拒绝」这个选项：不想要的友链直接删。但历史数据里可能有
                 * rejected（早期接口写的），补一个禁用项，避免 select 落成空白、
                 * 一保存就把状态改成别的。
                 */}
                {form.status === 'rejected' && (
                  <option value="rejected">已拒绝（历史记录）</option>
                )}
                <option value="published">已通过（前台展示）</option>
                <option value="pending">待审核</option>
                <option value="hidden">已隐藏</option>
              </select>
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">排序值</span>
              <input
                className="friends__form-input"
                value={form.sortOrder}
                onChange={(e) => patch('sortOrder', e.target.value.replace(/[^\d-]/g, ''))}
                inputMode="numeric"
              />
              <span className="friends__form-hint">数字越小越靠前</span>
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">来源</span>
              <select
                className="friends__form-input"
                value={form.source}
                onChange={(e) => patch('source', e.target.value as Source)}
              >
                <option value="manual">手动添加</option>
                <option value="apply">访客申请</option>
              </select>
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">联系邮箱</span>
              <input
                className="friends__form-input"
                value={form.email}
                onChange={(e) => patch('email', e.target.value)}
                placeholder="仅后台可见"
                inputMode="email"
              />
            </label>

            <label className="friends__form-field">
              <span className="friends__form-label">申请留言</span>
              <textarea
                className="friends__form-input friends__form-textarea"
                value={form.message}
                onChange={(e) => patch('message', e.target.value)}
                placeholder="访客说过什么，仅后台可见"
                maxLength={300}
                rows={3}
              />
            </label>

            {initial?.submitIp ? (
              <div className="friends__form-field">
                <span className="friends__form-label">提交 IP</span>
                <span className="friends__form-readonly">{initial.submitIp}</span>
              </div>
            ) : null}
          </div>
        </div>

        {error && (
          <p className="friends__form-error" role="alert">
            {error}
          </p>
        )}

        <footer className="friends__dialog-foot">
          <span className="friends__dialog-tip">
            {isEdit ? `创建于 ${String(initial?.createdAt ?? '').slice(0, 10)}` : '按 Esc 关闭'}
          </span>
          <div className="friends__dialog-actions">
            <button type="button" className="friends__btn" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button
              type="button"
              className="friends__btn friends__btn--primary"
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default FriendFormDialog
