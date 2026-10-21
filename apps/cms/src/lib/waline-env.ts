import { createHash } from 'node:crypto'

/**
 * Waline 存储环境变量解析 —— 「POSTGRES_URL 是唯一真相」的收敛点。
 *
 * 为什么需要这个模块（2026-10-21 评论页「操作失败」的根因）：
 *
 *   @waline/vercel/src/config/config.js 在**模块加载期**从 process.env 选存储后端：
 *
 *     } else if (PG_DB || POSTGRES_DATABASE) { storage = 'postgresql'; ... }
 *     ...
 *     if (storage === null) {
 *       throw new Error('No valid storage found. Please check your environment variables.');
 *     }
 *
 *   **POSTGRES_URL 完全不参与这个判定** —— 它只在 adapter.js 里被拿去做
 *   `POSTGRES_URL?.includes('sslmode=require')` 这一个字符串判断。也就是说
 *   EdgeOne 上只配了 Payload 用的 POSTGRES_URL、没配 Waline 的五个拆分变量时，
 *   Waline 在 require 阶段就直接抛错（实测 546ms 内失败，成功启动要 5.7s）。
 *   而 index.js 把启动错误 catch 掉只记日志，Next 于是回一个 0 字节的空 500，
 *   前端 describeApiError 把 5xx 统一显示成「操作失败，请稍后重试」——
 *   用户看到的是一句什么信息都没有的报错。
 *
 * 因此这里在 require('@waline/vercel') **之前**把 POSTGRES_URL 拆成那五个变量，
 * 让运维只需要维护一条连接串。拆分变量若已显式配置则一律尊重，不覆盖。
 */

/** 配置缺失/不可解析时抛这个；路由层据此回 503 并把原因原样告诉后台操作者 */
export class WalineConfigError extends Error {
  status = 503

  constructor(message: string) {
    super(message)
    this.name = 'WalineConfigError'
    Object.setPrototypeOf(this, WalineConfigError.prototype)
  }
}

export interface WalineEnvPlan {
  /** split = 控制台已配拆分变量；derived = 由 POSTGRES_URL 推导；none = 两者皆无（此时会抛错） */
  source: 'split' | 'derived'
  host: string
  port: string
  database: string
  /** Supabase pooler 的 user 是 postgres.<project-ref>，可用于核对 ref typo（不含密码） */
  user: string
  prefix: string
  ssl: boolean
  /** env = 控制台配了 JWT_TOKEN；derived = 由数据库口令派生（见 resolveJwtKey） */
  jwtSource: 'env' | 'derived'
}

let cached: WalineEnvPlan | null = null

/**
 * 推导前拍下的「控制台到底配了什么」快照。
 *
 * 必须在模块加载期就拍：ensureWalineEnv() 会往 process.env 里写推导值，
 * 之后再读 process.env 就分不清「运维配的」和「我们补的」了 —— 而且第二次请求
 * 读到的会是上一次补的值，诊断端点会时对时错。模块加载期早于任何请求，
 * 拿到的是部署平台注入的原样环境。
 */
export const configuredEnv = {
  POSTGRES_DATABASE: Boolean(process.env.POSTGRES_DATABASE?.trim() || process.env.PG_DB?.trim()),
  POSTGRES_HOST: Boolean(process.env.POSTGRES_HOST?.trim() || process.env.PG_HOST?.trim()),
  POSTGRES_USER: Boolean(process.env.POSTGRES_USER?.trim() || process.env.PG_USER?.trim()),
  POSTGRES_PASSWORD: Boolean(process.env.POSTGRES_PASSWORD || process.env.PG_PASSWORD),
  POSTGRES_PORT: Boolean(process.env.POSTGRES_PORT?.trim() || process.env.PG_PORT?.trim()),
  POSTGRES_PREFIX: Boolean(process.env.POSTGRES_PREFIX?.trim() || process.env.PG_PREFIX?.trim()),
  POSTGRES_SSL: Boolean(process.env.POSTGRES_SSL || process.env.PG_SSL),
  JWT_TOKEN: Boolean(process.env.JWT_TOKEN?.trim()),
} as const

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')

/** 只在「当前没有值」时写入 —— 控制台的显式配置永远优先于推导值 */
const fill = (name: string, value: string): void => {
  const current = process.env[name]
  if (current === undefined || current.trim() === '') process.env[name] = value
}

/**
 * JWT 签名密钥：优先 JWT_TOKEN，缺省时由数据库口令派生。
 *
 * 为什么可以派生：Waline 自己就是这么兜底的（config.js 的 `jwtKey ||= PG_PASSWORD || POSTGRES_PASSWORD`）。
 * 我们额外做一次 sha256 而不是直接复用口令，是因为这枚密钥会进 jsonwebtoken 的 HMAC，
 * 一旦哪天令牌泄露、口令相同就意味着口令一起泄露。派生值稳定、不可逆推，且与控制台
 * 现有的信任边界一致（能读到 POSTGRES_URL 的人本来就能直接读库）。
 */
function resolveJwtKey(password: string): { key: string; source: 'env' | 'derived' } {
  const fromEnv = process.env.JWT_TOKEN?.trim()
  if (fromEnv) return { key: fromEnv, source: 'env' }
  const derived = createHash('sha256').update(`waline-jwt:${password}`).digest('hex')
  process.env.JWT_TOKEN = derived
  return { key: derived, source: 'derived' }
}

/**
 * 确保 Waline 所需的存储变量已就位（幂等、进程内只跑一次）。
 *
 * ⚠️ 必须在 `require('@waline/vercel')` 之前调用：config.js 在加载期求值，
 * 之后再改 process.env 不会重新选存储。
 */
export function ensureWalineEnv(): WalineEnvPlan {
  if (cached) return cached

  const splitConfigured = Boolean(
    (process.env.PG_DB ?? '').trim() || (process.env.POSTGRES_DATABASE ?? '').trim(),
  )

  if (splitConfigured) {
    // 控制台显式配了拆分变量：完全交给它，只补齐 prefix / ssl 这类可推导项
    const host = (process.env.PG_HOST ?? process.env.POSTGRES_HOST ?? '127.0.0.1').trim()
    const password = process.env.PG_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? ''
    const jwt = resolveJwtKey(password)
    const prefix = (process.env.PG_PREFIX ?? process.env.POSTGRES_PREFIX ?? 'wl_').trim() || 'wl_'
    cached = {
      source: 'split',
      host,
      port: (process.env.PG_PORT ?? process.env.POSTGRES_PORT ?? '5432').trim(),
      database: (process.env.PG_DB ?? process.env.POSTGRES_DATABASE ?? '').trim(),
      user: (process.env.PG_USER ?? process.env.POSTGRES_USER ?? '').trim(),
      prefix,
      ssl: (process.env.PG_SSL ?? process.env.POSTGRES_SSL) === 'true',
      jwtSource: jwt.source,
    }
    return cached
  }

  const rawUrl = process.env.POSTGRES_URL?.trim()
  if (!rawUrl) {
    throw new WalineConfigError(
      '评论服务未配置数据库：请设置 POSTGRES_URL（或 POSTGRES_HOST + POSTGRES_DATABASE）后重新部署',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new WalineConfigError('POSTGRES_URL 不是合法的连接串，评论服务无法启动')
  }

  const host = parsed.hostname
  // 连接串里的库名在 pathname（Supabase 是 /postgres）；为空时退回 postgres
  const database = parsed.pathname.replace(/^\//, '').trim() || 'postgres'
  const port = parsed.port || '5432'
  const user = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)

  const jwt = resolveJwtKey(password)

  fill('POSTGRES_HOST', host)
  fill('POSTGRES_PORT', port)
  fill('POSTGRES_USER', user)
  fill('POSTGRES_PASSWORD', password)
  fill('POSTGRES_DATABASE', database)
  // Waline 的默认前缀就是 wl_，这里显式写出来是为了让 /api/health 能显示实际生效值
  fill('POSTGRES_PREFIX', 'wl_')
  /*
   * 远程库一律开 SSL。adapter.js 里这条分支给的是 `{ rejectUnauthorized: false }`
   * （不校验证书，见 src/lib/pg-tls.ts 的批评），但**比明文强**：不开就是整条链路
   * 完全无加密，而 Supabase pooler 是接受明文的，Docker/sandbox 里很容易「看起来能用」。
   * 本机库（127.0.0.1 / localhost）不开，本地绿色版 PG 通常没配证书。
   */
  if ((process.env.PG_SSL ?? process.env.POSTGRES_SSL) === undefined && !isLocalHost(host)) {
    process.env.POSTGRES_SSL = 'true'
  }

  cached = {
    source: 'derived',
    host,
    port,
    database,
    user,
    prefix: (process.env.POSTGRES_PREFIX ?? 'wl_').trim() || 'wl_',
    ssl: (process.env.PG_SSL ?? process.env.POSTGRES_SSL) === 'true',
    jwtSource: jwt.source,
  }
  return cached
}

/** 诊断用：只回显非敏感字段，供 /api/health 暴露「实际生效的 Waline 配置」 */
export function describeWalineEnv(): (WalineEnvPlan & { error?: string }) | { error: string } {
  try {
    return ensureWalineEnv()
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
