import {
  registerSseClient,
  unregisterSseClient,
  sseClientCount,
} from '../../../../lib/sync-cache'

/**
 * SSE 推送端点
 *
 * 前台 BaseLayout 通过 EventSource 连接本端点。后台 afterChange 钩子清缓存后
 * 调用 broadcastSse('update', ...)，本端点把事件转发给所有在线客户端，
 * 客户端收到 update 后拉 /api/blog-sync?path=... 拿最新区块局部替换页面。
 *
 * 心跳：每 30 秒发送注释行，防止 EdgeOne / 中间层因空闲超时关闭连接。
 * 客户端断开（abort）时自动清理注册。
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const encoder = new TextEncoder()

export async function GET(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }

      const client = registerSseClient(
        (event, data) => {
          safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        },
        () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            // 已关闭
          }
        },
      )

      // 连接数达到上限时拒绝新连接
      if (!client) {
        safeEnqueue(
          `event: error\ndata: ${JSON.stringify({ message: 'SSE 连接数已满' })}\n\n`,
        )
        try {
          controller.close()
        } catch {
          // 已关闭
        }
        return
      }

      // 握手：告知客户端连接已建立 + 在线人数
      safeEnqueue(
        `event: hello\ndata: ${JSON.stringify({ id: client.id, online: sseClientCount() })}\n\n`,
      )

      // 心跳保活
      const heartbeat = setInterval(() => {
        safeEnqueue(`: keepalive ${Date.now()}\n\n`)
      }, 30_000)

      // 客户端断开 → 清理
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        if (client) unregisterSseClient(client)
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
