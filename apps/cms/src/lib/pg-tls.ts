/**
 * Postgres TLS 方案解析 —— 连接串与 ssl 对象的唯一收敛点
 *
 * 为什么单独成模块：
 *   payload.config.ts 用它决定 pg 真正生效的 SSL 行为，/api/health 用它回显同一份结论，
 *   两边共用一套逻辑，杜绝「诊断显示正常、实际配置却是另一回事」的漂移。
 *
 * ⚠️ 2026-10-12 线上事故（改这里之前务必读完）：
 *
 *   pg@8 的 ConnectionParameters 处理 connectionString 的方式是
 *     config = Object.assign({}, config, parse(config.connectionString))
 *   —— **连接串的解析结果会覆盖显式传入的配置**
 *   （node_modules/pg/lib/connection-parameters.js:59-61）。
 *
 *   而 pg-connection-string 的 parse() 里有一条：
 *     if (config.sslcert || config.sslkey || config.sslrootcert || config.sslmode) {
 *       config.ssl = {}
 *     }
 *   （node_modules/pg-connection-string/index.js:77-79）
 *
 *   两者叠加的后果：**只要连接串里出现 sslmode（哪怕只是 sslmode=prefer）**，
 *   整个 ssl 对象就会被重建为空 {}，我们精心注入的
 *   { rejectUnauthorized: true, ca: <Supabase 根证书> } 被静默丢弃，
 *   于是回落到 Node 默认信任库（不含 Supabase 根证书）→
 *   "self-signed certificate in certificate chain"
 *   → Payload 初始化失败 → /admin、/api/*、首页数据注入 全站 500。
 *
 *   这正是当时「CA 证书明明已经打进函数包、/api/health 也探测到证书存在，
 *   却依然连不上」的真正原因 —— 问题不在证书有没有进包，而在它有没有被用上。
 *
 * 因此本模块的约定是：
 *   1. 连接串只负责 host / port / user / password / database（及其它非 SSL 参数）；
 *   2. **SSL 行为一律由显式 ssl 对象决定**，连接串里的 ssl* 参数全部剔除；
 *   3. 剔除动作对「用户在控制台把 sslmode 写进 POSTGRES_URL」这种手滑同样有效；
 *   4. 注入的 ca 是「Node 内置 Mozilla 根证书 + Supabase 根证书」的合集。
 *      必须带上前者：pg 的 ssl.ca 是**替换**而不是追加信任库，只给 Supabase 根证书
 *      会让任何走公共 CA 的库（Neon / RDS / 自建）反而连不上 —— 修一个坑别挖出另一个。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rootCertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'

/**
 * 会让 pg 把整个 ssl 对象重置为 {} 的查询参数。
 * 前 6 个是 pg-connection-string/index.js:77 的判据原文；
 * uselibpqcompat 一并剔除：它是 libpq 兼容开关，会让 prefer/require 的语义变成
 * 「不校验证书」，与我们「严格校验」的默认策略冲突。
 */
const SSL_QUERY_KEYS = new Set([
  'sslmode',
  'ssl',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
])

/** Supabase CA 相对应用根目录的位置 */
const CA_RELATIVE = path.join('certs', 'supabase-ca.pem')

/** 已加载证书的元信息（只含公开信息，可安全回显给诊断端点） */
export interface CaInfo {
  /** 实际命中的文件路径 */
  path: string
  bytes: number
  /** PEM 里包含的证书块数（Supabase 链应为 2：Root + Intermediate） */
  blocks: number
}

/** 最终交给 pg 的 ssl 配置（TLS 行为的唯一来源） */
export type PgSslConfig = false | { rejectUnauthorized: boolean; ca?: string[] }

export interface PgTlsPlan {
  /** 已剔除 SSL 参数的连接串，可直接交给 pg */
  connectionString: string | undefined
  /** 交给 pg 的 ssl 配置 —— TLS 行为的唯一来源 */
  ssl: PgSslConfig | undefined
  /** 是否开启证书校验（PG_SSL_INSECURE=1 时降级为 false） */
  strict: boolean
  /** 本机 PG（默认跳过 TLS） */
  isLocal: boolean
  /** 连接串主机名（不含凭据，可安全回显） */
  host: string | null
  /** 从连接串里剔除掉的参数名，用于诊断「用户串里是不是本来就带 ssl 参数」 */
  strippedQueryKeys: string[]
  /** Supabase CA 的加载情况；loaded=false 才是真的缺文件 */
  ca: ({ loaded: true } & CaInfo) | { loaded: false }
  /** 实际写进 ssl.ca 的证书总数（Mozilla 内置 + Supabase），便于核对信任库规模 */
  trustStoreCerts: number
}

/** 取连接串主机名；解析失败返回 null（不抛错，调用方据此走兜底） */
function hostOf(connectionString?: string): string | null {
  if (!connectionString) return null
  try {
    return new URL(connectionString).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 本机 PG（127.0.0.1 / localhost / ::1）。
 * 本地绿色版没开 SSL，而 pg 只要拿到非 undefined 的 ssl 配置就会强制完成 TLS 协商，
 * 会直接报 "The server does not support SSL connections"，所以本机连接必须不带 ssl。
 */
export function isLocalPg(connectionString?: string): boolean {
  const host = hostOf(connectionString)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * 剔除连接串里所有 SSL 相关查询参数，其余参数（pgbouncer、connect_timeout 等）原样保留。
 * @returns value：处理后的连接串；stripped：被剔除的参数名（诊断用）
 */
export function stripSslParams(connectionString: string): { value: string; stripped: string[] } {
  const qIndex = connectionString.indexOf('?')
  if (qIndex === -1) return { value: connectionString, stripped: [] }

  const base = connectionString.slice(0, qIndex)
  const stripped: string[] = []
  const kept = connectionString
    .slice(qIndex + 1)
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const key = decodeURIComponent(pair.split('=')[0] ?? '').toLowerCase()
      if (SSL_QUERY_KEYS.has(key)) {
        stripped.push(key)
        return false
      }
      return true
    })

  return { value: kept.length > 0 ? `${base}?${kept.join('&')}` : base, stripped }
}

/**
 * 读取 Supabase CA 证书。
 *
 * 候选顺序覆盖「本地开发 / Next standalone / EdgeOne 容器 cwd 漂移」三种落点，
 * 与 scripts/ensure-supabase-ca.mjs 的投放位置一一对应，任一份命中即可。
 * 传 caFile（SUPABASE_CA_FILE）时优先用它 —— 应急场景可在控制台改一个变量，无需重新部署。
 */
export function loadSupabaseCa(caFile?: string): { pem: string; info: CaInfo } | null {
  // 本文件位于 src/lib/，上两级即应用根目录 apps/cms
  const here = path.dirname(fileURLToPath(import.meta.url))

  const candidates = [
    caFile,
    path.resolve(here, '..', '..', CA_RELATIVE),
    path.resolve(process.cwd(), CA_RELATIVE),
    path.resolve(process.cwd(), 'apps', 'cms', CA_RELATIVE),
    // EdgeOne 容器实测 cwd（/api/health 探针回报）
    path.resolve('/var/user', 'apps', 'cms', CA_RELATIVE),
    path.resolve('/var/task', CA_RELATIVE),
    // 兜底：从 cwd 逐级向上找（容器把应用放在任意层级时）
    ...[1, 2, 3].map((depth) =>
      path.resolve(process.cwd(), ...Array.from({ length: depth }, () => '..'), CA_RELATIVE),
    ),
  ].filter((p): p is string => !!p)

  for (const candidate of candidates) {
    try {
      const pem = readFileSync(candidate, 'utf-8')
      if (!pem.includes('BEGIN CERTIFICATE')) continue
      return {
        pem,
        info: {
          path: candidate,
          bytes: Buffer.byteLength(pem),
          blocks: (pem.match(/BEGIN CERTIFICATE/g) ?? []).length,
        },
      }
    } catch {
      // 继续试下一个候选
    }
  }
  return null
}

/**
 * 解析出最终交给 pg 的「连接串 + ssl 配置」。
 *
 * @param input.connectionString POSTGRES_URL 原值
 * @param input.insecure         PG_SSL_INSECURE=1：跳过证书校验（连通性兜底，有中间人风险）
 * @param input.caFile           SUPABASE_CA_FILE：显式指定 CA 路径（应急覆盖）
 * @param input.localSsl         PG_LOCAL_SSL=1：给本机 PG 也走严格 TLS
 */
export function resolvePgTls(input: {
  connectionString?: string
  insecure?: boolean
  caFile?: string
  localSsl?: boolean
}): PgTlsPlan {
  const strict = !input.insecure
  const isLocal = isLocalPg(input.connectionString) && !input.localSsl

  const { value: connectionString, stripped } = input.connectionString
    ? stripSslParams(input.connectionString)
    : { value: input.connectionString, stripped: [] as string[] }

  // 远程 + 严格模式下就注入 CA（不再按主机名做判断）：
  // 因为注入的是「Mozilla 根证书 + Supabase 根证书」合集，对任何公共 CA 的库都无害，
  // 少一个「主机名没匹配上」的判断就少一处会静默失效的地方。
  const needsCa = strict && !isLocal && Boolean(input.connectionString)
  const ca = needsCa ? loadSupabaseCa(input.caFile) : null

  // ssl 是 TLS 行为的唯一来源：undefined = 交给 pg 自行决定（仅 sqlite / 未配库时出现）
  const ssl: PgSslConfig | undefined = isLocal
    ? false
    : input.connectionString
      ? {
          rejectUnauthorized: strict,
          // rootCertificates 必须一起带上：pg 的 ca 是替换而非追加信任库
          ...(ca ? { ca: [...rootCertificates, ca.pem] } : {}),
        }
      : undefined

  const trustStoreCerts =
    ssl && typeof ssl === 'object' && ssl.ca ? ssl.ca.length : 0

  return {
    connectionString,
    ssl,
    strict,
    isLocal,
    host: hostOf(input.connectionString),
    strippedQueryKeys: stripped,
    ca: ca ? { loaded: true, ...ca.info } : { loaded: false },
    trustStoreCerts,
  }
}
