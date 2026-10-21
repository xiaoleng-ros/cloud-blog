import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { resolvePgTls } from '../../../lib/pg-tls'
import { resolveStorageConfig, refFromUrl } from '../../../lib/supabase-storage'

// 临时诊断端点（问题定位后可删除）：
// EdgeOne 函数容器里拿不到交互式日志，这个端点把三类定位信息直接吐进 HTTP 响应：
//   1. cwd 与「外壳目录」各候选路径是否存在 —— 定位「静态层有外壳、函数容器里没有」的打包差异
//   2. 关键环境变量「是否被注入进程」（只报 true/false，不回显值）
//   3. Payload 初始化的真实报错（getPayload 抛的原始错误会被 routeError 吞成笼统的
//      "There was an error initializing Payload"，这里自己调用一次拿到根因）
// 注意：payload.config 的 fail-fast 是「throw + 延迟 process.exit(1)」，导入前必须
// 暂时屏蔽 process.exit，否则进程会在响应发出前被拉死，诊断信息一个字节都出不去。
//
// ⚠️ 生产环境默认 404：响应里含 cwd、目录结构、环境变量存在性、CA 路径、连接串 ref
// 等内部信息，匿名可访问就是在给攻击者递侦察报告。
// 线上排障时在 EdgeOne 控制台加环境变量 HEALTH_TOKEN，请求带头
// `x-health-token: <HEALTH_TOKEN 值>` 才放行：
//   curl -H 'x-health-token: <token>' https://blog.iceuu.icu/api/health
// 不配置 HEALTH_TOKEN = 线上任何人 404，本地开发不受影响。
export const dynamic = 'force-dynamic'

const HTML_DIR_NAME = '__blog'

/** 恒定时间比较，避免 token 比对本身成为计时侧信道 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8')
  const bb = Buffer.from(b, 'utf-8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function GET(request: NextRequest) {
  // 生产环境守卫：未配置 HEALTH_TOKEN 或 token 不匹配 → 404（用 404 而非 401/403，
  // 不暴露「这个端点存在」这一事实本身）
  if (process.env.NODE_ENV === 'production') {
    const expected = process.env.HEALTH_TOKEN
    const provided = request.headers.get('x-health-token')
    if (!expected || !provided || !safeEqual(provided, expected)) {
      return new NextResponse(null, { status: 404 })
    }
  }

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
    // 评论服务现在直接用 POSTGRES_URL（不再拆分变量），所以这里只回显连接串是否存在。
    // 拆分变量的存在性已不再影响评论服务，但保留显示便于排查历史配置。
    POSTGRES_DATABASE: !!process.env.POSTGRES_DATABASE,
    POSTGRES_HOST: !!process.env.POSTGRES_HOST,
    POSTGRES_USER: !!process.env.POSTGRES_USER,
    POSTGRES_PREFIX: !!process.env.POSTGRES_PREFIX,
    JWT_TOKEN: !!process.env.JWT_TOKEN?.trim(),
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
  //   - user/port：Supabase pooler 的 user 含项目 ref，与控制台项目地址一对比即现形
  //     （2026-10-12 终极根因：ref typo，报错与项目暂停一模一样，极具误导性）
  // 三者组合可一次性区分「修复没部署」「证书没进包」「证书进了包但被连接串覆盖」。
  const pgTls = resolvePgTls({
    connectionString: process.env.POSTGRES_URL,
    insecure: process.env.PG_SSL_INSECURE === '1',
    caFile: process.env.SUPABASE_CA_FILE,
    localSsl: process.env.PG_LOCAL_SSL === '1',
  })

  // 2.7 存储配置（2026-10-21 图片全挂的关键诊断项）
  //
  // 症状是「图片管理页面全是破图、只显示 alt 文字」，但数据库 media.url 完全正确。
  // 根因：afterRead 钩子用 generateFileURL **在读取时按环境变量重算** url，
  // 覆盖掉库里那份，所以库对 ≠ 接口对。当时控制台的 SUPABASE_PROJECT_REF 抄错两位，
  // 拼出的域名 DNS 都不存在（<错ref>.supabase.co → NXDOMAIN），表现为
  // `<ref>.storage.supabase.co` 网关回 400 "Project not specified."。
  //
  // 这里把「实际生效的 ref / 端点」直接吐出来，与控制台项目地址一对比即现形。
  // 只回显公开读地址（本来就是浏览器直连的公开 URL），不回显任何密钥。
  const storage = resolveStorageConfig()
  // 与 alignRef 共用同一条正则（含 .storage. 形状），否则诊断端点会把事故藏起来
  const storageRef = refFromUrl(storage.publicBase) ?? null
  const dbRef = /postgres\.([a-z0-9]{20})@/i.exec(process.env.POSTGRES_URL ?? '')?.[1] ?? null

  // 2.8 评论服务配置（自写轻量版，直接用 POSTGRES_URL）
  //
  // 自 2026-10-21 起，评论服务从 @waline/vercel（进程内桥接）切换为自写的
  // waline-server.ts：用 pg 直连 wl_* 表，直接吃 POSTGRES_URL，不再需要拆分变量派生。
  // 这里回显连接串的 host/user（user = postgres.<ref>，可核对 ref typo），
  // 以及评论服务用的 6543 事务池地址。
  const waline = (() => {
    const url = process.env.POSTGRES_URL
    if (!url) return { configured: false, error: '未设置 POSTGRES_URL' }
    try {
      const parsed = new URL(url)
      const host = parsed.hostname
      const user = decodeURIComponent(parsed.username || '')
      // 评论服务走 6543 事务池（避免 5432 session 池 15 连接打满）
      const pooler6543 = url.replace(':5432/', ':6543/')
      return {
        configured: true,
        host,
        user,
        port: parsed.port || '5432',
        pooler6543,
        prefix: process.env.POSTGRES_PREFIX ?? 'wl_',
        auditEnabled: process.env.COMMENT_AUDIT !== 'false',
      }
    } catch {
      return { configured: false, error: 'POSTGRES_URL 解析失败' }
    }
  })()

  // 3. Payload 初始化真实报错
  // 生产缺配时 payload.config 的 fail-fast 会排程 setTimeout(exit(1))。
  // 诊断方置全局抑制开关，让 throw 仍发生（本端点捕获展示根因）但不再杀进程。
  // 旧做法是全局打补丁 process.exit 并在 finally 恢复——恢复早于 0ms 定时器触发，
  // 实际挡不住退出；改用 payload.config 检查的显式开关后无全局副作用。
  const g = globalThis as Record<string, unknown>
  const prevSuppress = g.__cloudSuppressPayloadFailFast
  g.__cloudSuppressPayloadFailFast = true
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
    g.__cloudSuppressPayloadFailFast = prevSuppress
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
        // Supabase pooler 的 user = postgres.<ref>，即 tenant 标识。
        // 与控制台项目地址（https://<ref>.supabase.co）对比，ref typo 一秒现形 ——
        // 2026-10-12 全站 500 的终极根因就是这里错了两位，host 却是对的。
        user: pgTls.user,
        port: pgTls.port,
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
      /**
       * 存储实际生效值。refMismatch=true 表示公开读域名用的 ref 与数据库连接串里的
       * 不一致 —— 这就是「图片全挂但数据库一切正常」的那条路径，必须立刻修。
       */
      storage: {
        ready: storage.ready,
        bucket: storage.bucket ?? null,
        publicBase: storage.publicBase ?? null,
        endpoint: storage.endpoint ?? null,
        configRef: storageRef,
        dbRef,
        refMismatch: Boolean(storageRef && dbRef && storageRef !== dbRef),
        // 控制台手填的原始值（可能抄错），与上面实际生效值对照
        envProjectRef: process.env.SUPABASE_PROJECT_REF ?? null,
      },
      /**
       * Waline 评论存储实际生效值。注意上面的 env 段是**推导之前**拍的快照，
       * 所以「env.POSTGRES_DATABASE=false 但 waline.source=derived」是正常组合，
       * 含义是「控制台没配拆分变量，由 POSTGRES_URL 推导补齐」。
       */
      waline,
      payload,
    },
    { status: payload.ok ? 200 : 503 },
  )
}
