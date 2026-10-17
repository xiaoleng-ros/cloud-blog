'use client'

/**
 * 后台管理视图共用的非阻塞 toast 提示条
 *
 * 为什么用 toast 而不是 alert()：
 *   alert() 是浏览器原生同步弹窗，会冻结整个页面（JS 主线程阻塞）——
 *   操作失败时 alert 弹出来，背后的确认弹窗还在、按钮还在转圈，用户「根本不能动」。
 *   toast 是 DOM 元素，创建/销毁不影响任何交互，用户始终可操作页面。
 *
 * 用法：
 *   const { toast, show } = useToast()
 *   // 触发：show('success', '保存成功') 或 show('error', '操作失败')
 *   // 渲染：<Toast toast={toast} />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error'
type ToastState = { type: ToastType; text: string } | null

/** toast 自动消失时长（ms） */
const AUTO_DISMISS_MS = 3200

/**
 * toast 状态管理 hook
 *
 * @returns { toast } 当前 toast 状态（null = 不显示）
 * @returns { show }  触发 toast：show(type, text)
 * @returns { dismiss } 手动关闭（传 true = 不计时自动关闭，用于长文案）
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setToast(null)
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const show = useCallback(
    (type: ToastType, text: string, durationMs: number = AUTO_DISMISS_MS) => {
      setToast({ type, text })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), durationMs)
    },
    [],
  )

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return { toast, show, dismiss }
}

/** 渲染 toast 浮层（portal 挂 body，避免祖先 transform 让 fixed 失效） */
export const Toast: React.FC<{ toast: ToastState }> = ({ toast }) => {
  if (!toast) return null

  return createPortal(
    <div className={`admin-toast admin-toast--${toast.type}`} role="status" aria-live="polite">
      <span className="admin-toast__icon" aria-hidden="true">
        {toast.type === 'success' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 7v6M12 17.2h.01" />
          </svg>
        )}
      </span>
      <span className="admin-toast__text">{toast.text}</span>
    </div>,
    document.body,
  )
}
