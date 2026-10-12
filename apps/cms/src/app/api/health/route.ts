import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

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
  }

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
    { cwd, htmlDirFound: dirs.find((d) => d.exists)?.path ?? null, dirs, env, payload },
    { status: payload.ok ? 200 : 503 },
  )
}
