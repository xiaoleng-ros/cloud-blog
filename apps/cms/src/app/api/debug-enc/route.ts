import { NextResponse } from 'next/server'

// 临时诊断接口：把函数实际收到的请求头原样回显，用于确认 EdgeOne 适配层
// 是否透传了 accept-encoding（HTML 压缩协商依赖它）。排查完即删。
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return NextResponse.json(
    {
      acceptEncoding: request.headers.get('accept-encoding'),
      headerKeys: Object.keys(headers).sort(),
      headers,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
