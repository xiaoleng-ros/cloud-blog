// 开发代理服务器：统一入口 http://localhost:4321
// - /admin 开头的请求 → Payload CMS (localhost:9527)
// - 其他所有请求     → Astro 博客 (localhost:3000)

import http from 'node:http'

const PORT = 4321
const CMS_URL = 'http://localhost:9527'
const ASTRO_URL = 'http://[::1]:3000'

/**
 * 将请求转发到目标服务器
 * @param {http.IncomingMessage} req - 客户端请求
 * @param {http.ServerResponse} res - 客户端响应
 * @param {string} targetUrl - 目标服务器地址（如 http://localhost:9527）
 */
function proxyRequest(req, res, targetUrl) {
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
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    console.error('[proxy] 转发失败:', err.message)
    res.writeHead(502)
    res.end('Bad Gateway')
  })

  req.pipe(proxyReq)
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

const server = http.createServer((req, res) => {
  if (isCmsPath(req.url)) {
    proxyRequest(req, res, CMS_URL)
  } else {
    proxyRequest(req, res, ASTRO_URL)
  }
})

server.listen(PORT, () => {
  console.log(`[proxy] 代理服务器已启动: http://localhost:${PORT}`)
  console.log(`[proxy]   ${CMS_PREFIXES.join(', ')}  → CMS (localhost:9527)`)
  console.log(`[proxy]   其他                         → Astro (localhost:3000)`)
})
