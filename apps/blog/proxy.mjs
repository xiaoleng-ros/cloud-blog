// 开发代理服务器：统一入口 http://localhost:4321
// - /admin 开头的请求 → Payload CMS (localhost:9527)
// - 其他所有请求     → Astro 博客 (localhost:3000)
// - WebSocket upgrade（Astro/Vite HMR 等）同样按路径转发，保证经 4321 访问时 HMR 不断线

import http from 'node:http'

const PORT = Number(process.env.PROXY_PORT) || 4321
const CMS_URL = process.env.CMS_TARGET || 'http://localhost:9527'

/**
 * Astro 前台目标：
 *  - 可用环境变量 ASTRO_TARGET 显式指定（如 http://127.0.0.1:3000）；
 *  - 默认依次尝试 IPv4 (127.0.0.1) 与 IPv6 ([::1])：Windows 下 Astro dev 实际监听
 *    哪个栈取决于解析顺序，硬编码单一协议（旧版写死 [::1]）会时好时坏。
 *    某个目标连续失败两次后自动切换下一个（见 markAstroTargetDown）。
 */
const ASTRO_TARGETS = (process.env.ASTRO_TARGET || 'http://127.0.0.1:3000,http://[::1]:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

let activeAstroTargetIndex = 0
let consecutiveAstroFailures = 0
const FAILURE_SWITCH_THRESHOLD = 2

function currentAstroTarget() {
  return ASTRO_TARGETS[activeAstroTargetIndex] ?? ASTRO_TARGETS[0]
}

function markAstroTargetDown() {
  consecutiveAstroFailures += 1
  if (consecutiveAstroFailures >= FAILURE_SWITCH_THRESHOLD && ASTRO_TARGETS.length > 1) {
    consecutiveAstroFailures = 0
    activeAstroTargetIndex = (activeAstroTargetIndex + 1) % ASTRO_TARGETS.length
    console.log(`[proxy] Astro 目标切换 → ${currentAstroTarget()}`)
  }
}

function markAstroTargetUp() {
  consecutiveAstroFailures = 0
}

// CMS 相关路径前缀：这些请求转发到 Payload CMS (9527)
// - /admin        后台管理页面
// - /_next        Next.js 构建资源（JS/CSS chunk，HTML 中以根相对路径引用）
// - /api          Payload REST API（后台面板数据请求）
// - /cloud-icons  CMS public 目录下的静态图标
const CMS_PREFIXES = ['/admin', '/_next', '/api', '/cloud-icons']

/**
 * 判断请求路径是否属于 CMS
 * @param {string} url - 请求路径（如 /admin/login）
 * @returns {boolean} true 表示转发到 CMS，false 表示转发到 Astro
 */
function isCmsPath(url) {
  return CMS_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?')
  )
}

/**
 * 将请求转发到目标服务器；转发失败且目标是 Astro 时自动换下一个候选地址重试
 * @param {http.IncomingMessage} req - 客户端请求
 * @param {http.ServerResponse} res - 客户端响应
 * @param {string} targetUrl - 目标服务器地址（如 http://localhost:9527）
 * @param {boolean} [isAstro] - 是否走 Astro 目标（决定失败后是否双试）
 */
function proxyRequest(req, res, targetUrl, isAstro = false, allowRetry = true) {
  const target = new URL(targetUrl)
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
  }

  const proxyReq = http.request(options, (proxyRes) => {
    if (isAstro) markAstroTargetUp()
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    // 客户端已断开等场景，res 可能不可写
    if (isAstro && allowRetry) {
      markAstroTargetDown()
      const next = currentAstroTarget()
      if (next !== targetUrl) {
        // req 可能已被消费，重放风险大 → 提示后直接试下一个目标（多数失败发生在连接阶段、未发送 body）
        proxyRequest(req, res, next, true, false)
        return
      }
    }
    console.error('[proxy] 转发失败:', err.message)
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Bad Gateway')
    }
  })

  req.pipe(proxyReq)
}

/**
 * WebSocket upgrade 透传：把客户端 socket 与上游 socket 双向管道，
 * 让 Astro/Vite 的 HMR WebSocket 能穿透 4321 统一入口。
 */
function forwardUpgrade(req, clientSocket, head, targetUrl) {
  const target = new URL(targetUrl)
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }

  const proxyReq = http.request(options)

  proxyReq.on('upgrade', (proxyRes, upstreamSocket, upstreamHead) => {
    const headerLines = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n')
    clientSocket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${headerLines}\r\n\r\n`,
      () => {
        if (upstreamHead?.length) clientSocket.write(upstreamHead)
        upstreamSocket.pipe(clientSocket)
        clientSocket.pipe(upstreamSocket)
      },
    )
    clientSocket.on('error', () => upstreamSocket.destroy())
    upstreamSocket.on('error', () => clientSocket.destroy())
    clientSocket.on('close', () => upstreamSocket.destroy())
    upstreamSocket.on('close', () => clientSocket.destroy())
  })

  proxyReq.on('error', (err) => {
    console.error('[proxy] upgrade 转发失败:', err.message)
    clientSocket.destroy()
  })

  // 非 101 响应（上游拒绝升级）：销毁，避免悬挂
  proxyReq.on('response', () => proxyReq.destroy())
  proxyReq.end(head)
}

const server = http.createServer((req, res) => {
  if (isCmsPath(req.url)) {
    proxyRequest(req, res, CMS_URL)
  } else {
    proxyRequest(req, res, currentAstroTarget(), true)
  }
})

server.on('upgrade', (req, socket, head) => {
  const targetUrl = isCmsPath(req.url) ? CMS_URL : currentAstroTarget()
  forwardUpgrade(req, socket, head, targetUrl)
})

server.listen(PORT, () => {
  console.log(`[proxy] 代理服务器已启动: http://localhost:${PORT}`)
  console.log(`[proxy]   ${CMS_PREFIXES.join(', ')}  → CMS (${CMS_URL})`)
  console.log(`[proxy]   其他                         → Astro (${ASTRO_TARGETS.join(' | ')}，自动双试)`)
  console.log(`[proxy]   WebSocket upgrade 已透传（HMR 可穿透 4321）`)
})
