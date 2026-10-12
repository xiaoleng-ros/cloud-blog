import http from 'node:http'
import { createRequire } from 'node:module'

/**
 * 把 Waline 服务端（ThinkJS/Koa）以「进程内 HTTP 服务」的形态挂进 Next。
 *
 * 为什么不是手写 req/res 适配：
 *   @waline/vercel 的入口导出的是 `(req, res) => Promise`，内部 ThinkJS/Koa 会读
 *   `req.socket`、以流的方式消费 body、依赖 `res` 的 finish/close 事件与 writeHead
 *   语义。用 Web Request/Response 手工 duck-type 很容易在某个深层调用上静默崩。
 *   这里在进程内起一个只绑 127.0.0.1:0（随机端口、不对外）的真实 http.Server，
 *   Next 路由用 fetch 把请求原样转发进去，Koa 拿到的是货真价实的 Node req/res。
 *
 * 单例放 globalThis：Next dev 热重载会重新求值本模块，若不放全局会每次请求重新
 * require + 重新 listen，端口泄漏且 beforeStartServer 反复触发。
 */
type WalineHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>

interface Bridge {
  port: number
}

const GLOBAL_KEY = '__walineBridge'

function getBridge(): Bridge | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Bridge | undefined
}

function setBridge(bridge: Bridge): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = bridge
}

let starting: Promise<Bridge> | null = null

async function startBridge(): Promise<Bridge> {
  const existing = getBridge()
  if (existing) return existing
  if (starting) return starting

  starting = (async () => {
    // @waline/vercel 是 CJS，且 ThinkJS 用运行时动态 require 加载其 src/*，
    // 必须保持 external（见 next.config.mjs 的 serverExternalPackages），
    // 因此这里用 createRequire 在运行时解析，绕开打包器的静态分析。
    const require = createRequire(import.meta.url)
    const createApp = require('@waline/vercel') as (config?: Record<string, unknown>) => WalineHandler
    const handler = createApp({})

    const server = http.createServer((req, res) => {
      handler(req, res).catch((err) => {
        console.error('[waline] 请求处理失败', err)
        if (!res.headersSent) res.statusCode = 500
        res.end('Waline internal error')
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('[waline] 无法获取内部服务端口')
    }
    const bridge: Bridge = { port: address.port }
    setBridge(bridge)
    // 进程退出时优雅关闭（不阻塞事件循环）
    server.unref()
    return bridge
  })().finally(() => {
    starting = null
  })

  return starting
}

/**
 * 把一个 Web Request 转发进内部 Waline 服务，返回 Web Response。
 * @param externalPath  Waline 原生路径（已剥掉 Next 挂载前缀），如 `/api/comment`
 * @param search        原始查询串（不含 `?`），可为空
 * @param request       原始 Next 路由收到的 Request（用于透传方法/头/体）
 */
export async function forwardToWaline(
  externalPath: string,
  search: string,
  request: Request,
): Promise<Response> {
  const { port } = await startBridge()

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    // 逐跳头与 host 交给 fetch 重新计算；host 用 x-forwarded-host 表达原始域名
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) return
    headers.set(key, value)
  })
  // 客户端真实 IP / 协议 / 域名：Waline 用 proxy:true 信任这些头
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) headers.set('x-forwarded-for', fwd)
  headers.set('x-forwarded-proto', request.headers.get('x-forwarded-proto') ?? 'https')
  const host = request.headers.get('host')
  if (host) headers.set('x-forwarded-host', host)

  const method = request.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()

  const target = `http://127.0.0.1:${port}${externalPath}${search ? `?${search}` : ''}`

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: 'manual',
  })

  const respHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (['transfer-encoding', 'connection', 'content-length', 'content-encoding'].includes(key.toLowerCase())) return
    respHeaders.set(key, value)
  })

  const respBody =
    method === 'HEAD' || upstream.status === 204 || upstream.status === 304
      ? null
      : await upstream.arrayBuffer()

  return new Response(respBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}
