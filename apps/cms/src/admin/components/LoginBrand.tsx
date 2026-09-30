'use client'

import { useEffect, type ReactNode } from 'react'

/**
 * 登录页行为注入器（全局 Provider，在所有后台页面加载）
 *
 * 功能：
 *   1. 登录页检测：根据 URL (/admin/login /admin/create-first-user 等)
 *      给 <html> 打 data-yx-page="login" 标记，驱动 admin-theme.css 中的
 *      登录页样式（样式全部按属性选择器作用域，不影响其它后台页面）
 *   2. 品牌区注入：在 .login__brand 容器内追加品牌文案（云岫小筑）
 *   3. 密码显隐切换：Payload 原生输入框无显隐按钮，此处补充
 *   4. 飞书入口归位：把 beforeLogin 插槽渲染的扫码块移到提交按钮之后
 *   5. 提交过渡态：登录请求进行中给 <html> 打 data-yx-transition 标记，
 *      失败（非 2xx）立即复位，避免表单停在半透明态无法重新输入
 *
 * 设计说明：
 *   - 不改 Payload 内部组件、不动表单 DOM 层级、不拦截提交事件，
 *     后端登录逻辑（邮箱密码 + 飞书扫码）零改动
 *   - 注入通过 MutationObserver 监听，确保 SPA 路由切换到登录页时也能注入
 */

type Props = {
  children?: ReactNode
}

export function LoginBrand({ children }: Props) {
  useEffect(() => {
    // 判断当前是否为登录页（含首次创建账号 / 忘记密码）
    const isLoginPage = () => {
      const p = window.location.pathname
      return (
        p === '/admin/login' ||
        p === '/admin/create-first-user' ||
        p === '/admin/forgot-password'
      )
    }

    /** 应用/移除登录页标记（主题只做浅色，不再强制深色） */
    const syncPageFlag = () => {
      if (isLoginPage()) {
        document.documentElement.dataset.yxPage = 'login'
      } else {
        delete document.documentElement.dataset.yxPage
      }
    }

    /** 向品牌区注入品牌文案（若尚未注入） */
    const injectBrandText = () => {
      if (!isLoginPage()) return
      const brand = document.querySelector('.login__brand')
      if (!brand) return
      if (brand.querySelector('.yx-brand')) return

      const wrap = document.createElement('div')
      wrap.className = 'yx-brand'
      wrap.innerHTML = `
        <div class="yx-brand__name">云岫小筑</div>
      `
      brand.appendChild(wrap)
    }

    /** 密码输入框右侧补充显隐切换图标按钮 */
    const ensurePasswordToggle = () => {
      if (!isLoginPage()) return
      const pwInput = document.querySelector<HTMLInputElement>(
        '.login__form input[type="password"]',
      )
      if (!pwInput) return
      const fieldWrap = pwInput.closest('.field-type')
      if (!fieldWrap) return
      if (fieldWrap.querySelector('.yx-pw-toggle')) return

      const inputWrap = pwInput.parentElement
      if (!inputWrap) return
      inputWrap.style.position = 'relative'

      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'yx-pw-toggle'
      toggle.setAttribute('aria-label', '显示或隐藏密码')
      toggle.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round">
          <path class="yx-eye-open"
                d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
          <circle class="yx-eye-open" cx="12" cy="12" r="3"/>
        </svg>
      `
      toggle.addEventListener('click', () => {
        const show = pwInput.type === 'password'
        pwInput.type = show ? 'text' : 'password'
        toggle.classList.toggle('yx-pw-toggle--show', show)
      })
      inputWrap.appendChild(toggle)
    }

    /**
     * 将「飞书扫码登录」块移动到提交按钮之后
     *
     * 背景：飞书按钮通过 Payload 的 beforeLogin 插槽注入，默认渲染在品牌下方、
     * 邮箱/密码字段之前，导致"第三方登录在账号密码之上"这种不常规的登录页顺序。
     * 常规登录页应为：邮箱 → 密码 → 提交 → 「或」 → 第三方登录。
     * 因此在此处把 .feishu-login-wrap 移动到 .form-submit 之后。
     *
     * 副作用：仅调整 DOM 顺序，不拦截事件、不改飞书按钮自身逻辑。
     */
    const relocateFeishuAfterSubmit = () => {
      if (!isLoginPage()) return
      const feishuWrap = document.querySelector('.feishu-login-wrap')
      if (!feishuWrap) return
      const form = document.querySelector<HTMLFormElement>('.login__form')
      if (!form) return
      const submit = form.querySelector('.form-submit')
      if (!submit) return
      // 已在正确位置则跳过（位于 .form-submit 之后）
      if (submit.nextElementSibling === feishuWrap) return
      submit.after(feishuWrap)
    }

    /**
     * 登录过渡状态管理（模块级共享，跨 MutationObserver 二次绑定复用）
     *
     * 为什么用共享变量：window.fetch 只 patch 一次，闭包内必须持有唯一
     * loginPending / resetTimer。若放在 bindSubmitTransition 内部，SPA 切换
     * 后新表单绑定时 fetch 内仍读第一次的闭包，兜底定时器会失效。
     */
    let loginPending = false
    let resetTimer: number | undefined

    /** 清除过渡态，让页面回到正常可见状态 */
    const resetTransition = () => {
      delete document.documentElement.dataset.yxTransition
      if (resetTimer !== undefined) {
        clearTimeout(resetTimer)
        resetTimer = undefined
      }
    }

    /** 兜底超时：3 秒后仍未收到登录响应则复位 */
    const armResetTimer = () => {
      if (resetTimer !== undefined) clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => {
        loginPending = false
        resetTransition()
      }, 3000)
    }

    // ── 一次性拦截 window.fetch，识别 Payload 登录请求 ──
    // 关键修复：登录失败（非 2xx）时立即清除过渡标记，避免表单
    // 永远保持半透明，让用户无法重新输入。
    const originalFetch = window.fetch.bind(window)
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const input = args[0]
      // 兼容 string / URL / Request 三种入参
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input?.url ?? ''
      // Payload 登录接口匹配：/api/:slug/login（slug 通常为 Users）
      if (/^\/api\/[^/?#]*\/login(\?|$)/.test(url)) loginPending = true
      try {
        const res = await originalFetch(...args)
        if (loginPending) {
          loginPending = false
          // 非 2xx（含 401 密码错误 / 422 校验失败 / 500 服务器错）→ 复位过渡态
          if (!res.ok) resetTransition()
        }
        return res
      } catch (err) {
        if (loginPending) {
          loginPending = false
          resetTransition()
        }
        throw err
      }
    }) as typeof fetch

    /** 登录提交：标记过渡态（不拦截原生提交），CSS 按属性存在性做半透明淡出 */
    const bindSubmitTransition = () => {
      if (!isLoginPage()) return
      const form = document.querySelector<HTMLFormElement>('.login__form')
      if (!form) return
      if (form.dataset.yxSubmitBound) return
      form.dataset.yxSubmitBound = '1'
      form.addEventListener(
        'submit',
        () => {
          document.documentElement.dataset.yxTransition = 'active'
          // 兜底：3s 后若没收到响应则复位
          armResetTimer()
          // 不调用 preventDefault，让 Payload 原生提交逻辑继续走
        },
        { capture: true },
      )
    }

    /** 一次性运行所有注入 */
    const runAll = () => {
      syncPageFlag()
      injectBrandText()
      ensurePasswordToggle()
      bindSubmitTransition()
      relocateFeishuAfterSubmit()
    }

    runAll()

    // 监听 DOM 变化（Payload SPA 路由切换时重新注入）
    const observer = new MutationObserver(() => {
      runAll()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      delete document.documentElement.dataset.yxPage
      // 复位过渡态，避免组件卸载时页面仍卡在淡出状态
      resetTransition()
      // 恢复原始 fetch（防 StrictMode 下双调用导致 fetch 被嵌套 patch）
      window.fetch = originalFetch
      observer.disconnect()
    }
  }, [])

  return children ?? null
}
