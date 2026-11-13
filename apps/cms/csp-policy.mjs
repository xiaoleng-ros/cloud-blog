/**
 * CSP 基线策略（第一阶段：Report-Only）。
 *
 * 为什么单独一个文件：这条策略要同时出现在两个地方，而这两处没法互相 import：
 *   1. `apps/cms/next.config.mjs` 的 `headers()`  —— 走 Node 函数的那部分响应；
 *   2. `apps/cms/edgeone.json` 的 `headers`       —— 静态层直接吐出的文件（静态化后的 HTML、
 *      `/_astro/*` 等），**不经过 Next，拿不到 next.config 的头**。
 * 两处手写必然漂移，所以这里做唯一来源，`apps/cms/scripts/verify-csp-sync.mjs`
 * 在 CI 与构建里对比两处取值是否一字不差。
 *
 * 为什么第一阶段只发 Report-Only：
 *   后台（Payload + vditor + lexical）大量内联脚本/内联样式，且第三方库会 `eval`。
 *   强制模式会直接白屏（`apps/cms/next.config.mjs` 第 138-139 行的原注释记着这个判断）。
 *   Report-Only 让浏览器照常渲染、同时把「本会被拦掉的东西」POST 到
 *   `apps/cms/src/app/api/csp-report/route.ts`。跑几天看真实分布，再收紧、再切强制。
 *
 * 策略为什么这么宽（每一处放宽都有具体来源，不是"先开着看看"）：
 *   - `script-src 'unsafe-inline' 'unsafe-eval'`：vditor / lexical / Payload admin 的内联
 *     初始化与动态求值。收紧要靠 nonce，而 nonce 需要服务端渲染时逐请求注入，
 *     静态化后的 HTML 做不到 —— 这也是这条基线先只覆盖 Report-Only 的原因之一。
 *   - `media-src https:`：音乐播放器的音频直链由 Meting 接口返回，指向网易云各 CDN
 *     节点，域名不固定也无法枚举（`apps/blog/src/components/MusicPlayer.astro:1987`
 *     那段兜底列表只覆盖 API host，不覆盖音频 CDN）。
 *   - `connect-src` 里的 meting 两个 host：`PUBLIC_MUSIC_API` 的默认值与兜底列表。
 *   - `img-src` 的 `*.supabase.co`：媒体库公开读前缀（`apps/cms/src/lib/supabase-storage.ts`
 *     拼出的 `https://<ref>.supabase.co/storage/v1/object/public`）。
 *   - `frame-src` 精确对应 `shared/md-sanitize-schema.mjs:37-43` 的 `MD_IFRAME_HOSTS`，
 *     两边必须同步；`verify-csp-sync.mjs` 也校验这一点。
 */

/** iframe 白名单，必须与 `shared/md-sanitize-schema.mjs` 的 MD_IFRAME_HOSTS 完全一致 */
const FRAME_HOSTS = [
  'https://music.163.com',
  'https://meting.mikus.ink',
  'https://player.bilibili.com',
  'https://www.youtube.com',
  'https://youtube.com',
]

const DIRECTIVES = [
  "default-src 'self'",
  // 后台第三方 SDK（飞书扫码登录）是唯一的外部脚本来源
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://lf-package-cn.feishucdn.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://weavatar.com https://q1.qlogo.cn https://*.supabase.co",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  `connect-src 'self' https://meting.mikus.ink https://api.injahow.cn https://*.supabase.co`,
  `frame-src ${FRAME_HOSTS.join(' ')}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // report-uri 虽在 CSP3 标为废弃，但仍是目前兼容性最好的上报通道；
  // report-to 需要额外的 Report-To 头，留到切强制模式时一起补。
  'report-uri /api/csp-report',
]

/** 完整的 CSP 策略字符串（Report-Only 与强制模式共用同一份取值） */
export const CSP_POLICY = DIRECTIVES.join('; ')

/** 第一阶段实际下发的响应头名 */
export const CSP_HEADER_NAME = 'Content-Security-Policy-Report-Only'

export { FRAME_HOSTS }
