import {
  ensureSseSweepLoop,
  registerSseClient,
  sseClientCount,
  unregisterSseClient,
  type SseClient,
} from '../../../../lib/sync-cache'

/**
 * SSE 推送端点
 *
 * 前台 BaseLayout 通过 EventSource 连接本端点。后台 afterChange 钩子清缓存后
 * 调用 broadcastSse('update', ...)，本端点把事件转发给所有在线客户端，
 * 客户端收到 update 后拉 /api/blog-sync?path=... 拿最新区块局部替换页面。
 *
 * 连接回收（这里实测踩过坑，注释别删）：
 * 浏览器关掉页面后 `controller.enqueue()` 并不会抛错 —— 字节只是排进 ReadableStream
 * 自己的队列；运行时何时发现连接已死、会不会触发 abort / cancel 全看实现。本地 Next dev
 * 实测「每个断开的客户端都残留一条注册 + 一个 30s 心跳定时器」，静置 65 秒也不消失。
 * 所以清理不能只挂在 abort / 写失败上，而是三条路径叠加：
 *   1. request.signal abort —— 运行时支持时最快
 *   2. ReadableStream cancel() —— 消费者取消，不依赖 abort
 *   3. 与信号无关的时间兜底 —— 单连接存活上限 + 模块级定期扫描
 * 第 3 条是关键：活跃浏览器在连接被回收后按 retry 自动重连（等于续期），死连接最迟
 * 一个上限周期被回收，注册集合不会随访问量单调增长到撞 MAX_SSE_CLIENTS。
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const encoder = new TextEncoder()

/** 正常重连间隔：连接被服务端回收后 5s 内回到推送链路 */
const RETRY_MS = 5_000
/** 连接数满时告知浏览器的重连间隔。EventSource 认识 `retry:` 字段，
 *  不写的话它会按默认 ~3s 疯狂重连，把上限变成自我 DoS。 */
const REJECT_RETRY_MS = 300_000
/** 心跳：防中间层空闲超时，顺带探测连接是否还收得进数据 */
const HEARTBEAT_MS = 30_000
/** 单连接最长存活时间：到期主动断开，回收那些「断开信号丢失」的连接 */
const MAX_LIFETIME_MS = 10 * 60_000
/** 队列积压阈值（按帧计）：达到即认定消费者不再取数据，等同连接已死 */
const BACKLOG_LIMIT = 8

export async function GET(request: Request) {
  ensureSseSweepLoop()

  // cancel() 与 start() 不在同一作用域，用可变引用把「消费者取消」接到内部清理上
  let teardownRef: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false
        let client: SseClient | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null
        let expireTimer: ReturnType<typeof setTimeout> | null = null

        /** 队列已积压 = 对端不再消费 */
        const backlogged = (): boolean => {
          const desired = controller.desiredSize
          return desired !== null && desired <= 0
        }

        const safeEnqueue = (chunk: string): boolean => {
          if (closed) return false
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            return false
          }
          // 写入没抛错不代表对端还活着：积压到阈值就判死
          return !backlogged()
        }

        /** 幂等清理：abort / cancel / 写失败 / 到期，哪条先走到都只生效一次 */
        const teardown = () => {
          if (closed) return
          closed = true
          if (heartbeat) {
            clearInterval(heartbeat)
            heartbeat = null
          }
          if (expireTimer) {
            clearTimeout(expireTimer)
            expireTimer = null
          }
          if (client) {
            unregisterSseClient(client)
            client = null
          }
          try {
            controller.close()
          } catch {
            // 流已被运行时关闭（cancel 分支）
          }
        }
        teardownRef = teardown

        client = registerSseClient({
          send: (event, data) => {
            const ok = safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            if (!ok) teardown()
            return ok
          },
          close: teardown,
          alive: () => !closed && !backlogged(),
        })

        // 连接数达到上限时拒绝新连接
        if (!client) {
          safeEnqueue(`retry: ${REJECT_RETRY_MS}\n\n`)
          safeEnqueue(
            `event: error\ndata: ${JSON.stringify({ message: 'SSE 连接数已满' })}\n\n`,
          )
          teardown()
          return
        }

        // 握手：重连间隔 + 在线人数
        if (
          !safeEnqueue(`retry: ${RETRY_MS}\n\n`) ||
          !safeEnqueue(
            `event: hello\ndata: ${JSON.stringify({ id: client.id, online: sseClientCount() })}\n\n`,
          )
        ) {
          return
        }

        // 心跳保活；写失败即代表连接已死：自行注销，不等到下一次广播
        heartbeat = setInterval(() => {
          if (!safeEnqueue(`: keepalive ${Date.now()}\n\n`)) teardown()
        }, HEARTBEAT_MS)
        // 不阻塞进程退出（测试 / 优雅关闭时不必等在跑的连接）
        heartbeat.unref?.()

        // 存活上限：主动断开，活跃客户端由 EventSource 自动重连续期，死连接借此回收
        expireTimer = setTimeout(teardown, MAX_LIFETIME_MS)
        expireTimer.unref?.()

        // 客户端断开 → 清理
        request.signal.addEventListener('abort', teardown)
      },

      // 消费者取消（浏览器断开）：不依赖 abort 事件的第二条快速路径
      cancel() {
        teardownRef?.()
      },
    },
    new CountQueuingStrategy({ highWaterMark: BACKLOG_LIMIT }),
  )

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
