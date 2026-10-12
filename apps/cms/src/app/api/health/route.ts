import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { resolvePgTls } from '../../../lib/pg-tls'

// 临时诊断端点（问题定位后可删除）：
// EdgeOne 函数容器里拿不到交互式日志，这个端点把三类定位信息直接吐进 HTTP 响应：
//   1. cwd 与「外壳目录」各候选路径是否存在 —— 定位「静态层有外壳、函数容器里没有」的打包差异
//   2. 关键环境变量「是否被注入进程」（只报 true/false，不回显值）
//   3. Payload 初始化的真实报错（getPayload 抛的原始错误会被 routeError 吞成笼统的
//      "There was an error initializing Payload"，这里自己调用一次拿到根因）
// 注意：payload.config 的 fail-fast 是「throw + 延迟 process.exit(1)」，导入前必须
// 暂时屏蔽 process.exit，否则进程会在响应发出前被拉死，诊断信息一个字节都出不去。
export const dynamic = 'force-dynamic'

const HTML_DIR_NAME = '__blog'

export async function GET() {
  const cwd = process.cwd()

  // 1. 外壳目录候选探测（与 src/app/[[...path]]/route.ts 的 resolveHtmlDir 同口径 + .next 兜底位）
  const candidates = [
    process.env.CMS_HTML_DIR,
    join(cwd, 'public', HTML_DIR_NAME),
    join(cwd, '.next', HTML_DIR_NAME),
    join(cwd, 'apps', 'cms', 'public', HTML_DIR_NAME),
    join(cwd, 'apps', 'cms', '.next', HTML_DIR_NAME),
    '/var/task/public/__blog',
  ].filter((p): p is string => !!p)
  const dirs = candidates.map((p) => {
    let sample: string[] | undefined
    try {
      if (existsSync(p)) sample = readdirSync(p).slice(0, 6)
    } catch {
      /* 探测异常按不存在处理 */
    }
    return { path: p, exists: !!sample, sample }
  })

  // 2. 环境变量注入情况（只报存在性）
  const env = {
    DATABASE_DRIVER: process.env.DATABASE_DRIVER ?? null,
    PAYLOAD_SECRET: !!process.env.PAYLOAD_SECRET,
    POSTGRES_URL: !!process.env.POSTGRES_URL,
    SUPABASE_S3_ACCESS_KEY_ID: !!process.env.SUPABASE_S3_ACCESS_KEY_ID,
    SUPABASE_S3_SECRET_ACCESS_KEY: !!process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    SUPABASE_BUCKET: !!process.env.SUPABASE_BUCKET,
    SUPABASE_PROJECT_REF: !!process.env.SUPABASE_PROJECT_REF,
    NODE_ENV: process.env.NODE_ENV ?? null,
    // PG_SSL_INSECURE：若线上为 true，说明走了降级分支、报的是别的问题
    PG_SSL_INSECURE: process.env.PG_SSL_INSECURE ?? null,
    SUPABASE_CA_FILE: process.env.SUPABASE_CA_FILE ?? null,
  }

  // 2.5 Supabase CA 证书探测（2026-10-12 线上 Payload 全站 500 的关键诊断项）
  //
  // 这个分支能一次性区分两种完全不同的情况：
  //   - 「本次修复根本没部署」（新探测代码也不存在 → 看不到 certs 字段）
  //   - 「部署了但证书没进函数包」（能看到 certs 字段但全是 found:false）
  // 两者修法完全不同，必须能在线上区分开。
  const caCandidates = [
    process.env.SUPABASE_CA_FILE,
    join(cwd, 'certs', 'supabase-ca.pem'),
    join(cwd, 'apps', 'cms', 'certs', 'supabase-ca.pem'),
    join('/var/user', 'apps', 'cms', 'certs', 'supabase-ca.pem'),
    join('/var/task', 'certs', 'supabase-ca.pem'),
  ].filter((p): p is string => !!p)
  const certs = caCandidates.map((p) => {
    try {
      const pem = readFileSync(p, 'utf-8')
      return { path: p, found: true, bytes: pem.length, blocks: (pem.match(/BEGIN CERTIFICATE/g) ?? []).length }
    } catch {
      return { path: p, found: false }
    }
  })

  // 2.6 实际生效的 Postgres TLS 方案（2026-10-12 事故的关键观测量）
  //
  // 专门回答「注入的 CA 到底有没有被 pg 用上」—— 证书在包里 ≠ 证书被使用：
  //   - strippedQueryKeys 非空 → POSTGRES_URL 自带 sslmode 等参数（已被自动剔除，属修复后的正常行为）
  //   - ssl.rejectUnauthorized=false → 走了 PG_SSL_INSECURE=1 降级分支
  //   - ssl.hasCa=false / ca.loaded=false → 才是真的没拿到证书
  // 三者组合可一次性区分「修复没部署」「证书没进包」「证书进了包但被连接串覆盖」。
  const pgTls = resolvePgTls({
    connectionString: process.env.POSTGRES_URL,
    insecure: process.env.PG_SSL_INSECURE === '1',
    caFile: process.env.SUPABASE_CA_FILE,
    localSsl: process.env.PG_LOCAL_SSL === '1',
  })

  // 3. Payload 初始化真实报错
  const realExit = process.exit.bind(process)
  ;(process as { exit: unknown }).exit = () => {}
  let payload: { ok: true } | { ok: false; error: string }
  try {
    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('@payload-config'),
    ])
    await getPayload({ config })
    payload = { ok: true }
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string; code?: string } }
    const cause = e?.cause ? ` | cause: ${e.cause.code ?? ''} ${e.cause.message ?? e.cause}` : ''
    payload = { ok: false, error: `${e?.message ?? String(err)}${cause}`.slice(0, 600) }
  } finally {
    ;(process as { exit: unknown }).exit = realExit
  }

  return NextResponse.json(
    {
      cwd,
      htmlDirFound: dirs.find((d) => d.exists)?.path ?? null,
      dirs,
      env,
      certs,
      pgTls: {
        host: pgTls.host,
        strict: pgTls.strict,
        isLocal: pgTls.isLocal,
        // 非空 = 用户在 POSTGRES_URL 里写了 ssl 参数，已被自动剔除
        strippedQueryKeys: pgTls.strippedQueryKeys,
        ssl:
          pgTls.ssl === false
            ? false
            : pgTls.ssl
              ? {
                  rejectUnauthorized: pgTls.ssl.rejectUnauthorized,
                  hasCa: Boolean(pgTls.ssl.ca),
                  trustStoreCerts: pgTls.ssl.ca?.length ?? 0,
                }
              : null,
        ca: pgTls.ca,
        trustStoreCerts: pgTls.trustStoreCerts,
      },
      payload,
    },
    { status: payload.ok ? 200 : 503 },
  )
}
