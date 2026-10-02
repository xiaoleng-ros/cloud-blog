'use client'

/**
 * 自定义账号设置视图（替换 Payload 默认 /account 页）
 *
 * 功能说明：
 * - 与站点设置页同款版式：左侧竖排目录（账号信息 / 基本资料 / 修改密码）+ 右侧内容面板
 * - 面板状态同步到 URL（?tab=info|profile|password），刷新/前进后退都能停在本面板
 * - 骨架常驻：目录与面板框架立即渲染，/api/users/me 数据到达前用占位符
 * - 操作结果使用提示条展示
 */
import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { PASSWORD_RULE_TEXT, validatePasswordStrength } from '../../lib/password'
import { PageHeader } from '../components/PageHeader'

/** 当前登录用户（仅取用到的字段） */
type MeUser = {
  /** 用户 id */
  id: number
  /** 邮箱（登录账号） */
  email: string
  /** 昵称（可空） */
  name?: string
}

/** 居中提示条的类型 */
type Notice = { type: 'success' | 'error'; text: string } | null

/** 面板标识（与 URL ?tab= 参数一一对应） */
type Tab = 'info' | 'profile' | 'password'

/** 17px 线性图标，风格与站点设置目录一致 */
const icon = (path: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const TABS: Array<{ key: Tab; label: string; desc: string; icon: ReactNode }> = [
  {
    key: 'info',
    label: '账号信息',
    desc: '登录标识',
    icon: icon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
      </>,
    ),
  },
  {
    key: 'profile',
    label: '基本资料',
    desc: '昵称与邮箱',
    icon: icon(
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>,
    ),
  },
  {
    key: 'password',
    label: '修改密码',
    desc: '6-18 位 · 两种组合',
    icon: icon(
      <>
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>,
    ),
  },
]

/** 解析 URL 中的 tab 参数，非法值回落到「账号信息」 */
const parseTab = (value: string | null): Tab =>
  value === 'profile' || value === 'password' ? value : 'info'

/** 账号设置视图组件（挂在 admin.components.views.account.Component） */
export const AccountView = () => {
  // —— 当前用户与加载状态 ——
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)

  // —— 当前面板：SSR 首帧固定「账号信息」，挂载后再从 URL 恢复，避免水合不一致 ——
  const [tab, setTab] = useState<Tab>('info')

  // —— 基本资料表单状态 ——
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // —— 修改密码表单状态 ——
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // —— 提交状态 ——
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // —— 提示条 ——
  const [notice, setNotice] = useState<Notice>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 弹出提示，数秒后自动消失
   * @param type 提示类型（成功/错误）
   * @param text 提示文案
   */
  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3200)
  }

  // 卸载时清理提示定时器，避免卸载后 setState 告警 / 泄漏
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    [],
  )

  // —— 挂载时读取当前登录用户 ——
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/users/me', { credentials: 'include' })
        const json = await res.json()
        const u = json?.user as MeUser | undefined
        if (u) {
          setUser(u)
          setName(u.name ?? '')
          setEmail(u.email)
        } else {
          showNotice('error', '未能读取当前登录账户，请刷新页面。')
        }
      } catch {
        showNotice('error', '加载账户信息失败，请检查网络后重试。')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // —— 挂载时从 URL 恢复面板；前进/后退切换面板 ——
  useEffect(() => {
    const readTab = () => setTab(parseTab(new URLSearchParams(window.location.search).get('tab')))
    readTab()
    window.addEventListener('popstate', readTab)
    return () => window.removeEventListener('popstate', readTab)
  }, [])

  /** 切换面板并写入 URL 历史（浏览器前进/后退可回到上一个面板） */
  const switchTab = (next: Tab) => {
    if (next === tab) return
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.pushState({ tab: next }, '', url.toString())
  }

  /** 提取后端返回的错误文案，便于直接展示给用户 */
  const errorMessage = (json: { errors?: Array<{ message?: string }> }, fallback: string) =>
    json?.errors?.[0]?.message || fallback

  /**
   * 保存基本资料（昵称 + 邮箱）
   */
  const saveProfile = async () => {
    if (!user) return
    if (!email.trim()) {
      showNotice('error', '邮箱不能为空')
      return
    }
    setSavingProfile(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(errorMessage(json, '保存失败，请稍后重试'))
      // 本地同步最新资料
      setUser((prev) => (prev ? { ...prev, name: name.trim(), email: email.trim() } : prev))
      showNotice('success', '基本资料已保存')
    } catch (e) {
      showNotice('error', (e as Error).message)
    } finally {
      setSavingProfile(false)
    }
  }

  /**
   * 修改密码（旧密码 + 新密码 + 确认）
   * 走自定义路由 /api/change-password：服务端先校验旧密码再落库，
   * 会话被窃也无法在不知道旧密码的情况下改密永久接管。
   * 强度规则见 lib/password（6-18 位、至少两类组合，属产品决策，不额外加严）。
   */
  const savePassword = async () => {
    if (!user) return
    // 旧密码是否必填由服务端判定：已设过密码的账号必须验旧密；
    // 从未设密（如仅飞书扫码注册）的账号可直接设置，前端不再提前拦截。
    const strengthError = validatePasswordStrength(newPassword)
    if (strengthError) {
      showNotice('error', strengthError)
      return
    }
    if (newPassword !== confirm) {
      showNotice('error', '两次输入的密码不一致')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(errorMessage(json, '修改失败，请稍后重试'))
      // 清空密码输入，防止误提交
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      showNotice('success', '密码已更新')
    } catch (e) {
      showNotice('error', (e as Error).message)
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="settings">
      {/* 结果提示条 */}
      {notice && <div className={`account-view__notice account-view__notice--${notice.type}`}>{notice.text}</div>}

      {/* 页头 */}
      <PageHeader title="账号设置" />

      <div className="settings__layout">
        {/* 左侧目录 */}
        <nav className="settings__menu" aria-label="账号设置分区">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`settings__menu-item${tab === t.key ? ' settings__menu-item--active' : ''}`}
              onClick={() => switchTab(t.key)}
            >
              <span className="settings__menu-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="settings__menu-text">
                <span className="settings__menu-title">{t.label}</span>
                <span className="settings__menu-desc">{t.desc}</span>
              </span>
              {tab === t.key && <span className="settings__menu-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        {/* 右侧面板 */}
        <section className="settings__panel">
          {tab === 'info' && (
            <>
              <h2 className="settings__panel-title">账号信息</h2>
              <div className="account-view__identity">
                <span className="account-view__avatar">
                  {user ? user.name?.slice(0, 1) || user.email.slice(0, 1).toUpperCase() : '…'}
                </span>
                <div className="account-view__identity-text">
                  <span className="account-view__identity-name">
                    {user ? user.name || '未设置昵称' : '加载中…'}
                  </span>
                  <span className="account-view__identity-email">{user ? user.email : '—'}</span>
                </div>
              </div>
            </>
          )}

          {tab === 'profile' && (
            <>
              <h2 className="settings__panel-title">基本资料</h2>
              <div className="settings__grid">
                <label className="settings__field settings__field--full">
                  <span className="settings__field-label">昵称</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="给自己起个好听的名字"
                  />
                </label>
                <label className="settings__field settings__field--full">
                  <span className="settings__field-label">邮箱（登录账号）</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              </div>
              <button
                type="button"
                className="settings__submit"
                onClick={() => void saveProfile()}
                disabled={savingProfile || loading}
              >
                {savingProfile ? '保存中…' : '保存资料'}
              </button>
            </>
          )}

          {tab === 'password' && (
            <>
              <h2 className="settings__panel-title">修改密码</h2>
              <p className="account-view__hint">密码要求：{PASSWORD_RULE_TEXT}。</p>
              <div className="settings__grid">
                <label className="settings__field settings__field--full">
                  <span className="settings__field-label">旧密码</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="输入当前密码"
                    autoComplete="current-password"
                  />
                </label>
                <label className="settings__field settings__field--full">
                  <span className="settings__field-label">新密码</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="输入新密码"
                    autoComplete="new-password"
                  />
                </label>
                <label className="settings__field settings__field--full">
                  <span className="settings__field-label">确认新密码</span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <button
                type="button"
                className="settings__submit"
                onClick={() => void savePassword()}
                disabled={savingPassword || loading}
              >
                {savingPassword ? '更新中…' : '更新密码'}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
