import { NextResponse } from 'next/server'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'

// 临时诊断接口，排查完即删。
// 目的：搞清 EdgeOne 对「函数返回体」到底什么时候做压缩。
// 已知事实：
//   - 函数收到的 accept-encoding 恒为 identity（适配层剥离）
//   - 函数返回带 Content-Encoding 的体，平台会解开再按客户端真实能力重编码
// 待验证：函数返回「不带 Content-Encoding 的大文本」时，平台会不会主动压。
export const dynamic = 'force-dynamic'

const BIG = '云岫的博客性能诊断'.repeat(8000) // 约 200KB UTF-8

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

  // 大文本、不设 Content-Encoding：看平台是否代劳
  if (force === 'big-plain') {
    return new NextResponse(BIG, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
      },
    })
  }

  // 大文本 + 声明 br（我们自己的做法）：看平台是否透传/重编
  if (force === 'big-br') {
    const body = brotliCompressSync(BIG, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    })
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Encoding': 'br',
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
    { acceptEncoding: request.headers.get('accept-encoding'), headerKeys: Object.keys(headers).sort() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
