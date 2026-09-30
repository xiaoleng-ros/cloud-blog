'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 飞书登录入口（登录页 beforeLogin 插槽）
 *
 * 使用场景：
 *   - 忘记密码时用飞书扫码登入，然后进后台改密码
 *   - 也可以作为日常登录的备选方案（若不想输密码）
 *
 * 前提：
 *   - 已在飞书开发者后台创建企业自建应用
 *   - 已在 apps/cms/.env 配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REDIRECT_URI
 *   - 首次使用需在 Payload 后台给管理员账号填入 feishu.openId（或配置 FEISHU_ADMIN_EMAIL 自动绑定）
 *
 * 组件行为（二维码 SDK 内嵌方案）：
 *   - 点击「用飞书扫码登录」→ 弹窗内由飞书官方二维码 SDK 渲染二维码
 *   - 每次打开弹窗 / 点「刷新二维码」都会重新请求授权地址并生成新二维码
 *   - 必须用手机飞书 App 扫码 + 在手机上确认授权，无法用浏览器已有登录态一键跳过
 *   - 扫码确认后：拼接 tmp_code 跳转到飞书授权端点 → 飞书回调 /api/feishu/callback
 *   - callback 自签 JWT → 写 payload-token cookie → 跳回 /admin（后端逻辑未改动）
 *   - 不允许任何绕过扫码的路径（无「跳转授权」降级、无一键完成登录）
 *
 * 视觉：
 *   - 入口按钮沿用 class="feishu-login-link"（样式在 admin-theme.css 中定义）
 *   - 弹窗复用 .publish-modal 系列样式，保持后台弹窗视觉一致
 */

/** 飞书官方二维码 SDK（内嵌二维码，避免跳转到飞书登录页） */
const FEISHU_QR_SDK_URL =
  'https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js'

/** 二维码挂载容器的 DOM id（SDK 按 id 查找容器） */
const QR_CONTAINER_ID = 'feishu-qr-container'

/**
 * QRLogin 实例：SDK 返回的校验方法
 * - matchOrigin：校验 postMessage 来源域名是否为飞书官方域名
 * - matchData：校验 postMessage 数据格式是否合法
 */
type QRLoginInstance = {
  matchOrigin: (origin: string) => boolean
  matchData: (data: unknown) => boolean
}

/** SDK 注入到 window 的全局函数 */
declare global {
  interface Window {
    QRLogin?: (options: {
      id: string
      goto: string
      width?: string
      height?: string
      style?: string
    }) => QRLoginInstance
  }
}

/** SDK 脚本加载 Promise 缓存（全局只插入一次 script 标签） */
let sdkPromise: Promise<void> | null = null

/**
 * 按需加载飞书二维码 SDK
 * @returns 加载完成的 Promise；已加载过则立即 resolve
 */
function loadFeishuQrSdk(): Promise<void> {
  if (typeof window !== 'undefined' && window.QRLogin) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = FEISHU_QR_SDK_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      sdkPromise = null // 允许后续重试
      reject(new Error('飞书二维码 SDK 加载失败，请检查网络后重试'))
    }
    document.body.appendChild(script)
  })
  return sdkPromise
}

export function FeishuLoginLink() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  // 刷新二维码：自增即触发重新初始化（used as React key，强制重建 DOM 容器）
  const [round, setRound] = useState(0)
  // 当前二维码对应的授权地址（扫码成功后要拼接 tmp_code 跳转到这里）
  const gotoRef = useRef('')
  // QRLogin 实例（postMessage 校验用）
  const instanceRef = useRef<QRLoginInstance | null>(null)
  // 当前 postMessage 监听器（关闭弹窗/卸载时移除，避免泄漏与重复跳转）
  const listenerRef = useRef<((event: MessageEvent) => void) | null>(null)

  /** 移除 postMessage 监听 */
  const removeListener = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('message', listenerRef.current)
      listenerRef.current = null
    }
  }, [])

  /** 打开弹窗：重置错误与二维码轮次 */
  const handleOpen = () => {
    setError('')
    setRound(0)
    setOpen(true)
  }

  /** 关闭弹窗并清理监听 */
  const handleClose = () => {
    setOpen(false)
    removeListener()
  }

  /** 刷新二维码：重新拉取授权地址并重建二维码 */
  const handleRefresh = () => {
    setError('')
    setRound((r) => r + 1)
  }

  // 弹窗打开（或刷新）时：拉取授权地址 → 加载 SDK → 渲染二维码 → 监听扫码结果
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const init = async () => {
      try {
        // 1. 每次打开/刷新都从服务端取新的 state（二维码不可复用）
        const res = await fetch('/api/feishu/redirect?mode=json', { cache: 'no-store' })
        if (!res.ok) throw new Error('获取飞书授权地址失败')
        const data = (await res.json()) as { qrAuthUrl?: string }
        if (!data.qrAuthUrl) throw new Error('飞书授权地址为空')
        if (cancelled) return
        gotoRef.current = data.qrAuthUrl

        // 2. 加载 SDK（首次会插入 script 标签，后续走缓存）
        await loadFeishuQrSdk()
        if (cancelled) return

        // 3. 在容器内渲染二维码（key=round 已保证是全新 DOM 节点）
        const container = document.getElementById(QR_CONTAINER_ID)
        if (!container || !window.QRLogin) throw new Error('二维码容器未就绪')
        container.innerHTML = ''
        instanceRef.current = window.QRLogin({
          id: QR_CONTAINER_ID,
          goto: data.qrAuthUrl,
          style: 'border:none;background-color:#ffffff;width:266px;height:266px;',
        })

        // 4. 监听扫码结果：手机确认授权后 SDK 会 postMessage 回传 tmp_code，
        //    拼到授权地址后跳转，飞书随即 302 回调 /api/feishu/callback?code=...
        removeListener()
        const onMessage = (event: MessageEvent) => {
          const instance = instanceRef.current
          if (!instance) return
          // 官方要求：先校验来源域名与数据格式，防止伪造 postMessage
          if (!instance.matchOrigin(event.origin)) return
          if (typeof instance.matchData === 'function' && !instance.matchData(event.data)) return
          const tmpCode = (event.data as { tmp_code?: string } | null)?.tmp_code
          if (!tmpCode) return
          window.location.href = `${gotoRef.current}&tmp_code=${encodeURIComponent(tmpCode)}`
        }
        listenerRef.current = onMessage
        window.addEventListener('message', onMessage, false)
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '二维码初始化失败')
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [open, round, removeListener])

  // 组件卸载时清理监听
  useEffect(() => () => removeListener(), [removeListener])

  return (
    <>
      <div className="feishu-login-wrap">
        <div className="feishu-login-divider" aria-hidden>
          <span>或</span>
        </div>
        <button type="button" className="feishu-login-link" onClick={handleOpen}>
          <svg
            className="feishu-login-icon"
            viewBox="0 0 48 48"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="44" height="44" rx="10" fill="#00D6B9" />
            <path
              d="M14 20c4 0 6 2 8 6s4 6 8 6"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="16" cy="18" r="2" fill="#fff" />
            <circle cx="32" cy="18" r="2" fill="#fff" />
          </svg>
          <span>用飞书扫码登录</span>
        </button>
      </div>

      {open && (
        <div className="publish-modal__mask" onClick={handleClose}>
          <div className="publish-modal feishu-qr-modal" onClick={(e) => e.stopPropagation()}>
            <header className="publish-modal__head">
              <h3 className="publish-modal__title">飞书扫码登录</h3>
              <button
                type="button"
                className="publish-modal__close"
                onClick={handleClose}
                aria-label="关闭"
              >
                ×
              </button>
            </header>

            <div className="publish-modal__body feishu-qr-modal__body">
              {error ? (
                <p className="feishu-qr-modal__error">{error}</p>
              ) : (
                <p className="feishu-qr-modal__hint">请用手机飞书 App 扫码，并在手机上确认授权</p>
              )}
              {/* key={round}：刷新时强制重建容器，确保 SDK 渲染的是全新二维码 */}
              <div key={round} id={QR_CONTAINER_ID} className="feishu-qr-modal__qr" />
              <p className="feishu-qr-modal__tip">二维码 5 分钟内有效，过期请点「刷新二维码」</p>
            </div>

            <footer className="publish-modal__foot">
              <button
                type="button"
                className="publish-modal__btn publish-modal__btn--primary"
                onClick={handleRefresh}
              >
                刷新二维码
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}