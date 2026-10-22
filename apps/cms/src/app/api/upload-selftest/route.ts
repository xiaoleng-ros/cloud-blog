import { NextResponse, type NextRequest } from 'next/server'
import { runStorageSelfTest, type StorageSelfTestResult } from '../../../lib/storage-selftest'

/**
 * 把自检结果翻译成一句「下一步该做什么」。
 *
 * 自检本身只报告事实（哪个异常、哪个状态码），而人拿到 `SignatureDoesNotMatch 403`
 * 的第一反应通常是「密钥过期了，去重置」——但实测有一半情况是控制台粘贴时带了引号或
 * 尾随空格，重置后照原样粘贴会再坏一次，白白绕一圈。所以这里直接把两种可能分开：
 * credentialHygiene.changed 为 true 说明归一化改动了值（控制台里存的就是脏值），
 * 此时**不需要**重置密钥，改值即可；为 false 才是真该重置。
 */
function diagnose(result: StorageSelfTestResult): string {
  const dirty = result.credentialHygiene.filter((h) => h.changed).map((h) => h.name)
  if (dirty.length) {
    return (
      `环境变量 ${dirty.join(' / ')} 带有多余的引号或空白（归一化已自动纠正，` +
      `本次上传可能已恢复正常）。建议去 EdgeOne 控制台清掉这些字符，避免下次换环境再踩。`
    )
  }
  const bucketErr = result.headBucket.ok ? result.putObject : result.headBucket
  if (bucketErr.ok) return '四段链路全部通过，图片上传应当正常。'
  const text = `${bucketErr.error ?? ''} ${bucketErr.code ?? ''}`
  if (/SignatureDoesNotMatch/i.test(text)) {
    // 长度判据比「签名不匹配」有用得多：Supabase 的 key 长度是固定的
    // （accessKeyId 32 位、secretAccessKey 64 位）。长度对不上 ⇒ 值在复制环节被
    // 截断/多粘了字符，重新复制一次即可；长度正常却还签名失败 ⇒ 是真·旧密钥。
    // 两者处置不同（改粘贴 vs 重置），所以这里必须先分开。
    const c = result.config
    const wrongLength =
      c.accessKeyIdLength !== 32 || c.secretAccessKeyLength !== 64
    if (wrongLength) {
      return (
        `凭据长度不对（accessKeyId ${c.accessKeyIdLength} 位、secretAccessKey ${c.secretAccessKeyLength} 位；` +
        `Supabase 固定为 32 / 64 位）—— 值在复制粘贴时被截断或多带了字符。` +
        `请回 Supabase 控制台 Storage → S3 access keys 重新完整复制一次。`
      )
    }
    return (
      '凭据签名不匹配，且环境变量本身干净、长度也正确 —— 说明 EdgeOne 里的 ' +
      'SUPABASE_S3_SECRET_ACCESS_KEY 与 Supabase 控制台当前那份不一致（多半是轮换过或复制的是旧的）。' +
      '请重新复制一次密钥并保存。'
    )
  }
  if (/InvalidAccessKeyId/i.test(text)) {
    return 'accessKeyId 在 Supabase 里不存在 —— 确认它与 SUPABASE_PROJECT_REF 属于同一个项目。'
  }
  if (/NotFound|404/i.test(text)) {
    return '端点路径不对，应为 https://<ref>.supabase.co/storage/v1/s3（少 /s3 会 404）。'
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(text)) {
    return '函数出口到不了对象存储域名 —— 检查 EdgeOne 的出网策略，或改用直连域。'
  }
  return '见下方 putObject / headBucket 的 error 字段。'
}

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
        diagnosis: diagnose(result),
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
