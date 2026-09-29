'use client'

/**
 * 自定义账号设置视图（替换 Payload 默认 /account 页）
 *
 * 功能说明：
 * - 顶部 Tab 分栏：账号信息 / 基本资料 / 修改密码，一次只看一个面板
 * - Tab 状态同步到 URL（?tab=info|profile|password），刷新/前进后退都能停在本面板
 * - 骨架常驻：Tab 与面板框架立即渲染，/api/users/me 数据到达前用占位符
 * - 操作结果使用居中弹层提示
 */
import React, { useEffect, useRef, useState } from 'react'
import { PASSWORD_RULE_TEXT, validatePasswordStrength } from '../../lib/password'

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

const TABS: Array<{ key: Tab; label: string; tag: string }> = [
  { key: 'info', label: '账号信息', tag: '登录标识' },
  { key: 'profile', label: '基本资料', tag: '昵称 · 邮箱' },
  { key: 'password', label: '修改密码', tag: '6-18 位 · 至少两种字符组合' },
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
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // —— 提交状态 ——
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  // —— 居中提示条 ——
  const [notice, setNotice] = useState<Notice>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 弹出居中提示，数秒后自动消失
   * @param type 提示类型（成功/错误）
   * @param text 提示文案
   */
  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3200)
  }

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
   * 修改密码（新密码 + 确认，两者需一致；强度规则见 lib/password）
   */
  const savePassword = async () => {
    if (!user) return
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
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(errorMessage(json, '修改失败，请稍后重试'))
      // 清空密码输入，防止误提交
      setNewPassword('')
      setConfirm('')
      showNotice('success', '密码已更新')
    } catch (e) {
      showNotice('error', (e as Error).message)
    } finally {
      setSavingPassword(false)
    }
  }

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0]

  return (
    <div className="account-view">
      {/* 居中结果提示条 */}
      {notice && <div className={`account-view__notice account-view__notice--${notice.type}`}>{notice.text}</div>}

      {/* 页头 */}
      <header className="account-view__header">
        <p className="account-view__eyebrow">Account</p>
        <h1 className="account-view__title">账号设置</h1>
        <p className="account-view__desc">管理登录账号的昵称、邮箱与密码。</p>
      </header>

      {/* 顶部分栏导航 */}
      <nav className="account-view__tabs" role="tablist" aria-label="账号设置分栏">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className={`account-view__tab${t.key === tab ? ' account-view__tab--active' : ''}`}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* 面板一：账号信息（只读标识，未来在此扩展修改头像） */}
      {tab === 'info' && (
        <section className="account-view__card">
          <div className="account-view__card-head">
            <h2 className="account-view__card-title">账号信息</h2>
            <span className="account-view__card-tag">{activeTab.tag}</span>
          </div>
          <div className="account-view__identity">
            <span className="account-view__avatar">{user ? user.name?.slice(0, 1) || user.email.slice(0, 1).toUpperCase() : '…'}</span>
            <div className="account-view__identity-text">
              <span className="account-view__identity-name">{user ? user.name || '未设置昵称' : '加载中…'}</span>
              <span className="account-view__identity-email">{user ? user.email : '—'}</span>
            </div>
          </div>
        </section>
      )}

      {/* 面板二：基本资料 */}
      {tab === 'profile' && (
        <section className="account-view__card">
          <div className="account-view__card-head">
            <h2 className="account-view__card-title">基本资料</h2>
            <span className="account-view__card-tag">{activeTab.tag}</span>
          </div>
          <div className="account-view__field">
            <label className="account-view__label" htmlFor="account-name">昵称</label>
            <input
              id="account-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给自己起个好听的名字"
              className="account-view__input"
            />
          </div>
          <div className="account-view__field">
            <label className="account-view__label" htmlFor="account-email">邮箱（登录账号）</label>
            <input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="account-view__input"
            />
          </div>
          <div className="account-view__actions">
            <button type="button" className="account-view__btn account-view__btn--primary" onClick={saveProfile} disabled={savingProfile || loading}>
              {savingProfile ? '保存中…' : '保存资料'}
            </button>
          </div>
        </section>
      )}

      {/* 面板三：修改密码 */}
      {tab === 'password' && (
        <section className="account-view__card">
          <div className="account-view__card-head">
            <h2 className="account-view__card-title">修改密码</h2>
            <span className="account-view__card-tag">{activeTab.tag}</span>
          </div>
          <p className="account-view__hint">密码要求：{PASSWORD_RULE_TEXT}。</p>
          <div className="account-view__field">
            <label className="account-view__label" htmlFor="account-new-password">新密码</label>
            <input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="输入新密码"
              className="account-view__input"
              autoComplete="new-password"
            />
          </div>
          <div className="account-view__field">
            <label className="account-view__label" htmlFor="account-confirm-password">确认新密码</label>
            <input
              id="account-confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入新密码"
              className="account-view__input"
              autoComplete="new-password"
            />
          </div>
          <div className="account-view__actions">
            <button type="button" className="account-view__btn account-view__btn--primary" onClick={savePassword} disabled={savingPassword || loading}>
              {savingPassword ? '更新中…' : '更新密码'}
            </button>
          </div>
        </section>
      )}

      {/* 退出登录（侧边导航底部已提供，这里不再重复） */}
    </div>
  )
}
