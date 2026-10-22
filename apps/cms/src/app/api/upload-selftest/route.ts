import { NextResponse, type NextRequest } from 'next/server'
import { runStorageSelfTest } from '../../../lib/storage-selftest'

/**
 * 图片上传链路自检（仅登录管理员可用）。
 *
 * 为什么需要它：线上上传失败时前端只拿到 `500 Something went wrong.`，EdgeOne 云函数
 * 又不给交互式日志，光看响应没法区分是凭据错、端点错、sharp 没进函数包，还是写库失败。
 *
 * 鉴权用 Payload 自己的会话 cookie：管理员在浏览器里登录着后台，直接在同一个域名下
 * 打开 /api/upload-selftest 就能拿到结果，不需要额外配置任何令牌。
 * 非管理员一律 403，避免匿名者拿这个端点做写入探针。
 *
 * 自检会真的写一次对象存储与一条 media 记录（随后立即删除），详见 lib/storage-selftest.ts。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // payload.config 的 fail-fast 是「throw + 延迟 process.exit(1)」：先挡住 exit，
  // 否则诊断信息会在响应发出前被进程自杀带走（与 /api/health 同款处理）。
  const g = globalThis as Record<string, unknown>
  const prevSuppress = g.__cloudSuppressPayloadFailFast
  g.__cloudSuppressPayloadFailFast = true

  try {
    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('@payload-config'),
    ])
    const payload = await getPayload({ config })

    const { user } = await payload.auth({ headers: request.headers })
    if (!user) {
      return NextResponse.json({ error: '需要登录后台管理员账号' }, { status: 403 })
    }

    const result = await runStorageSelfTest()
    const ok = result.headBucket.ok && result.putObject.ok && result.payloadCreate.ok
    return NextResponse.json(
      {
        ok,
        // 出问题时先看这三行的 ok 分布，能直接判断断在哪一段
        summary: {
          headBucket: result.headBucket.ok,
          putObject: result.putObject.ok,
          payloadCreate: result.payloadCreate.ok,
        },
        ...result,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const e = err as { name?: string; message?: string; stack?: string }
    return NextResponse.json(
      {
        ok: false,
        fatal: `${e?.name ?? ''} ${e?.message ?? String(err)}`.trim(),
        stack: e?.stack?.split('\n').slice(0, 8).join('\n'),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    g.__cloudSuppressPayloadFailFast = prevSuppress
  }
}
