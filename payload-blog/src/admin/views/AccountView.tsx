'use client'

/**
 * 自定义账号设置视图（替换 Payload 默认 /account 页）
 *
 * 功能说明：
 * - 用「块状卡片」的规整布局替代默认分散的表单，风格与仪表盘一致
 * - 卡片一「基本资料」：昵称 + 邮箱，PATCH /api/users/{id} 保存
 * - 卡片二「修改密码」：新密码 + 确认新密码，PATCH /api/users/{id}（携带 password）保存
 * - 操作结果使用居中弹层提示
 */
import React, { useEffect, useRef, useState } from 'react'

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

/** 账号设置视图组件（挂在 admin.components.views.account.Component） */
export const AccountView = () => {
  // —— 当前用户与加载状态 ——
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)

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
   * 修改密码（新密码 + 确认，两者需一致）
   */
  const savePassword = async () => {
    if (!user) return
    if (newPassword.length < 6) {
      showNotice('error', '新密码至少 6 位')
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

  if (loading) {
    return (
      <div className="account-view">
        <p className="account-view__loading">正在加载账户信息…</p>
      </div>
    )
  }

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

      {/* 当前登录标识 */}
      <div className="account-view__identity">
        <span className="account-view__avatar">{user?.name?.slice(0, 1) || user?.email.slice(0, 1).toUpperCase()}</span>
        <div className="account-view__identity-text">
          <span className="account-view__identity-name">{user?.name || '未设置昵称'}</span>
          <span className="account-view__identity-email">{user?.email}</span>
        </div>
      </div>

      {/* 卡片一：基本资料 */}
      <section className="account-view__card">
        <div className="account-view__card-head">
          <h2 className="account-view__card-title">基本资料</h2>
          <span className="account-view__card-tag">昵称 · 邮箱</span>
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
          <button type="button" className="account-view__btn account-view__btn--primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? '保存中…' : '保存资料'}
          </button>
        </div>
      </section>

      {/* 卡片二：修改密码 */}
      <section className="account-view__card">
        <div className="account-view__card-head">
          <h2 className="account-view__card-title">修改密码</h2>
          <span className="account-view__card-tag">至少 6 位</span>
        </div>
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
          <button type="button" className="account-view__btn account-view__btn--primary" onClick={savePassword} disabled={savingPassword}>
            {savingPassword ? '更新中…' : '更新密码'}
          </button>
        </div>
      </section>

      {/* 退出登录（侧边导航底部已提供，这里不再重复） */}
    </div>
  )
}