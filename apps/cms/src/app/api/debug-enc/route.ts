import { brotliCompressSync, gzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'

// 临时诊断接口：验证「函数自己返回压缩体」时边缘如何处理。
// - /api/debug-enc           → 回显函数收到的请求头（已确认 accept-encoding=identity）
// - /api/debug-enc?force=br  → 无视协商、强制以 br 返回，用来看客户端只接受 gzip 时能否解码
// - /api/debug-enc?force=gzip→ 强制 gzip
// 排查完即删。
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force')
  if (force === 'br' || force === 'gzip') {
    const text = `FORCED-${force}-${'x'.repeat(2000)}-END`
    const body = force === 'br' ? brotliCompressSync(text) : gzipSync(text)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Encoding': force,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
      },
    })
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return NextResponse.json(
    {
      acceptEncoding: request.headers.get('accept-encoding'),
      headerKeys: Object.keys(headers).sort(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
