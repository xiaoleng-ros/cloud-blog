// 注意：两个数据库适配器都必须静态导入，让 webpack 打包进产物。
// 之前用动态 import + webpackIgnore 导致包不进产物，EdgeOne 运行时报 ERR_MODULE_NOT_FOUND。
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { zh } from '@payloadcms/translations/languages/zh'
import path from 'path'
import { buildConfig } from 'payload'
import type { Plugin } from 'payload'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import sharp from 'sharp'

import { Categories } from './collections/Categories'
import { Media } from './collections/Media'
import { Notes } from './collections/Notes'
import { Posts } from './collections/Posts'
import { Projects } from './collections/Projects'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { Navigation } from './globals/Navigation'
import { SiteSettings } from './globals/SiteSettings'
// 迁移必须静态导入：一是让 webpack 打进 EdgeOne 运行产物（动态 import 不会被打包），
// 二是供 prodMigrations 在生产启动时自动补跑未执行的迁移（见下方 postgresAdapter）。
import { migrations } from './migrations'
// Postgres 连接串 / TLS 方案的唯一收敛点（含 2026-10-12 全站 500 的成因说明）
import { resolvePgTls } from './lib/pg-tls'
import { resolveStorageConfig } from './lib/supabase-storage'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * 对象存储（图片上传）：
 *  - 配齐 SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY + SUPABASE_BUCKET 时启用 S3 adapter
 *    文件直接进 Supabase Storage，不落容器磁盘
 *  - 未配置时降级为本地磁盘存储（开发环境默认）
 *
 * 生产环境（EdgeOne）必须配置以下环境变量：
 *   SUPABASE_S3_ACCESS_KEY_ID / SUPABASE_S3_SECRET_ACCESS_KEY
 *                                —— Supabase Dashboard → Project Settings → Storage →
 *                                   S3 Access Keys（或 Storage 页的 Connect to S3）生成的一对密钥。
 *                                   注意不是 service_role JWT：S3 协议只认这对接密钥。
 *   SUPABASE_BUCKET             —— Storage 里创建的 bucket 名（当前为 "blog-media"，公开读）
 *   SUPABASE_PROJECT_REF        —— 可选。缺省时从 POSTGRES_URL 主机名里的 ref 推导；
 *                                   本地库指向 127.0.0.1 时推不出来，必须显式配或配下面两项
 *   SUPABASE_S3_ENDPOINT        —— 可选，S3 协议 API 端点，默认
 *                                   https://<ref>.supabase.co/storage/v1/s3
 *                                   少了 /s3 这段会命中 Kong 的 404 Route not found
 *   SUPABASE_PUBLIC_BASE        —— 可选，公开读地址前缀，默认
 *                                   https://<ref>.supabase.co/storage/v1/object/public
 */
/**
 * endpoint / publicBase / 缺省的 project ref 推导 / 凭据清洗，统一交给 lib/supabase-storage.ts ——
 * /api/comment-image 用的是同一份，避免「插件能用、上传端点说没配置」的漂移。
 *
 * **不要再直接读 process.env**：resolveStorageConfig 会剥掉控制台粘贴时带上的包裹引号
 * 与首尾空白。这里直读会原样送给 SDK 参与 HMAC 计算，结果是插件侧
 * SignatureDoesNotMatch 403（2026-10-22 线上图片全部上传失败就是这条）。
 */
const STORAGE = resolveStorageConfig()
const SUPABASE_S3_ACCESS_KEY_ID = STORAGE.accessKeyId
const SUPABASE_S3_SECRET_ACCESS_KEY = STORAGE.secretAccessKey
const SUPABASE_BUCKET = STORAGE.bucket
const SUPABASE_S3_ENDPOINT = STORAGE.endpoint
const SUPABASE_PUBLIC_BASE = STORAGE.publicBase

/** S3/Supabase 对象存储凭据是否配齐（缺任何一项都不注入 s3Storage 插件） */
const HAS_S3_CONFIG = Boolean(
  SUPABASE_S3_ACCESS_KEY_ID && SUPABASE_S3_SECRET_ACCESS_KEY && SUPABASE_BUCKET && SUPABASE_S3_ENDPOINT && SUPABASE_PUBLIC_BASE,
)

/**
 * 图片对浏览器暴露的公开地址。
 *
 * 为什么不能省事用插件自带的 generateURL：它是 `${config.endpoint}/${bucket}/${key}` 的字符串硬拼，
 * 而 endpoint 同时是 S3 API 端点（…/storage/v1/s3）。该路径不接受匿名 GET（实测 403 Missing
 * signature），拼出来的地址打不开；公开读只有 …/storage/v1/object/public/<bucket>/<key> 一种形状。
 * 配合 disablePayloadAccessControl 使用，浏览器直连 Storage，不再由 CMS 进程拉流转发。
 */
const generateFileURL = ({ filename, prefix }: { filename: string; prefix?: string }) => {
  const key = prefix ? `${prefix.replace(/\/+$/, '')}/${filename}` : filename
  const encoded = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${SUPABASE_PUBLIC_BASE}/${SUPABASE_BUCKET}/${encoded}`
}

/**
 * 组装插件列表：仅当 S3 凭据齐全时注入 s3Storage。
 *
 * ⚠ 重要：插件开关由环境变量决定，但后台的组件映射表 `src/app/(payload)/admin/importMap.js`
 * 是构建期静态文件（`next build` 不会重新生成它）。一旦插件被激活却在 importMap 里
 * 找不到 `@payloadcms/storage-s3/client#S3ClientUploadHandler`，Payload 后台会「静默空白」：
 * 页面 200、CSS/JS 全部加载成功、控制台零报错，但 body 内没有任何元素和文字。
 * 因此改动这里的环境变量判断后，必须带同样的环境变量跑一次 `npm run generate:importmap`
 * 并提交 importMap.js。
 *
 * 类型断言说明：s3Storage(...) 通过 declare module 'payload' 扩展了 ConfigureAppOptions，
 * 本地 tsc 能识别，但 EdgeOne 编译链可能不加载该 augmentation，会误报
 * "Property 's3Storage' does not exist on type 'ConfigureAppOptions'"。
 * 用 `as unknown as Plugin` 强制收敛，运行时行为完全不变。
 */
const plugins: Plugin[] =
  HAS_S3_CONFIG
    ? [
        // HAS_S3_CONFIG 已保证各 env 均非空，但 TS 无法据此收窄 process.env 类型，
        // 故此处用非空断言。
        s3Storage({
          collections: {
            media: {
              // url 由下面的 generateFileURL 直接给出 Storage 公开地址，浏览器不再走 CMS 拉流。
              // （实测：dev 下 /api/media/file/<filename> 仍会由 Payload 的 staticDir 磁盘服务兜底命中，
              //  只要 media/ 里有旧文件就还能取到 —— 迁完旧图就该清那个目录，别依赖它）
              disablePayloadAccessControl: true,
              generateFileURL,
            },
          },
          bucket: SUPABASE_BUCKET!,
          // 不发 x-amz-acl：对象可读性由 bucket 的公开设置决定（blog-media 已是公开读桶），
          // 逐对象 ACL 不是 Supabase S3 层的写法，带上只可能添一次失败点
          config: {
            endpoint: SUPABASE_S3_ENDPOINT!,
            region: 'us-east-1', // Supabase 的 S3 兼容接口固定这个 region
            credentials: {
              accessKeyId: SUPABASE_S3_ACCESS_KEY_ID!,
              secretAccessKey: SUPABASE_S3_SECRET_ACCESS_KEY!,
            },
            // Supabase 的 S3 兼容层用 v4 签名，AWS SDK 默认即 v4，无需显式配置。
            // forcePathStyle 必须为 true：虚拟主机风格要 <bucket>.<ref>.supabase.co，
            // 这个域名根本不解析（实测 Could not resolve host），只能走 path 风格。
            forcePathStyle: true,
          },
          // 禁用本地磁盘副本，避免每次上传都落一份到容器临时目录
          disableLocalStorage: true,
        }) as unknown as Plugin,
      ]
    : []

/**
 * PAYLOAD_SECRET 处理策略（生产 fail-fast vs. 本地零配置）：
 *
 *  历史教训：此处用模块顶层 throw 强校验时，EdgeOne 云端缺变量会让整个模块
 *  import 就炸，Next.js 把 LayoutRouter children 静默降级为 null，
 *  前端拿到 `16:null` 后 InnerLayoutRouter 无限挂起，用户看到的是零报错白屏。
 *  所以生产 throw 之外**额外**显式 process.exit(1)：让进程以非零码退出、
 *  由平台记录崩溃原因（ fail-fast 且可见），而不是留一个静默白屏。
 *
 *  策略（P0-1 收紧）：
 *   1) 生产（NODE_ENV=production）：PAYLOAD_SECRET 必填且需通过强度校验，否则退出。
 *      不再存在「静默回落」路径 —— 之前的固定兜底串已入仓泄露，等同于公开密钥。
 *   2) 本地/测试：缺失时回落到**运行时随机**密钥（仓库里不留任何固定串），
 *      并打出横幅提示「重启即失效，登录态会丢」。
 *   3) PAYLOAD_REQUIRE_SECRET=1：让本地也走生产级硬校验（用于 CI 演练）。
 *   4) 无论是否回落，都会校验长度与占位特征（change-in-production / please-change-me），
 *      避免把 .env.example 的占位值抄进生产。
 *
 *  正确做法：在 EdgeOne 控制台 / 部署环境里显式配置 PAYLOAD_SECRET
 *  （建议长度 >= 48 的随机字符串）；本地开发可留空。
 */
const MIN_SECRET_LENGTH = 32
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const REQUIRE_SECRET = process.env.PAYLOAD_REQUIRE_SECRET === '1'
const providedSecret = process.env.PAYLOAD_SECRET

/** 历史上曾硬编码进仓库的兜底密钥，等同公开值，任何环境都不得再使用 */
const LEGACY_LEAKED_SECRET = 'clay-blog-dev-secret-key-2026-random-string-change-in-production'

/** 判断给定 secret 是否"看起来像默认占位值"（含 change-in-production / please-change-me 等关键词） */
const isPlaceholderSecret = (value: string) =>
  value === LEGACY_LEAKED_SECRET ||
  /change-in-production|please-change-me|xxxx|test-secret/i.test(value)

/** 校验 secret 是否符合生产要求，返回首个错误原因；null 表示通过 */
const validateSecret = (value: string): string | null => {
  if (!value) return '未配置'
  if (value === LEGACY_LEAKED_SECRET) return '仍在使用已泄露入仓的旧兜底密钥，请在部署平台轮换 PAYLOAD_SECRET'
  if (isPlaceholderSecret(value)) return '使用了默认占位值（不能包含 change-in-production / please-change-me）'
  if (value.length < MIN_SECRET_LENGTH) return `长度不足（当前 ${value.length}，至少 ${MIN_SECRET_LENGTH}）`
  return null
}

const secretProblem = validateSecret(providedSecret ?? '')
const mustHardFail = IS_PRODUCTION || REQUIRE_SECRET

/**
 * 诊断抑制开关：/api/health 排障时会现场 import 本配置做 getPayload 探测。
 * 若生产缺配，下面各 fail-fast 分支的 `setTimeout(exit(1))` 会杀掉整个进程，
 * 让诊断响应发不出去（health 端点只能全局打补丁 process.exit 来挡，且 finally 恢复
 * 早于 0ms 定时器触发、实际挡不住）。改为读全局开关：诊断方置 true 期间这些分支
 * 仍 throw（health 会捕获展示根因），只是不排程进程退出；正常启动路径不设开关，行为不变。
 */
const suppressFailFastExit = Boolean((globalThis as Record<string, unknown>).__cloudSuppressPayloadFailFast)

if (secretProblem && mustHardFail) {
  const banner = '='.repeat(64)
  console.error(`\n${banner}`)
  console.error('[payload] PAYLOAD_SECRET 不可用，拒绝启动')
  console.error(`[payload]   原因：${secretProblem}`)
  console.error('[payload]   修复：在部署平台配置 PAYLOAD_SECRET（>= 32 字符随机字符串）。')
  console.error(`${banner}\n`)
  // 顶层 throw 在 RSC import 上下文里可能被 Next 吞成静默白屏，
  // 因此下一拍强制退出，让平台侧能看到明确的崩溃原因。
  if (!suppressFailFastExit) setTimeout(() => process.exit(1), 0)
  throw new Error(`[payload] PAYLOAD_SECRET ${secretProblem}`)
}

/** 非生产环境的兜底：每次进程启动随机生成，仓库内不保留任何固定密钥串 */
const ephemeralSecret = randomBytes(32).toString('hex')
const payloadSecret = providedSecret || ephemeralSecret
const usingFallback = !providedSecret
const usingWeakSecret = !!providedSecret && secretProblem !== null

if (usingFallback || usingWeakSecret) {
  const banner = '='.repeat(64)
  const level = console.warn
  level(`\n${banner}`)
  level('[payload] ⚠⚠ PAYLOAD_SECRET 不安全配置 ⚠⚠')
  if (usingFallback) {
    level('[payload]   原因：未提供 PAYLOAD_SECRET，已回落到运行时随机密钥。')
    level('[payload]   影响：密钥仅在内存中，进程重启即更换 —— 已签发的登录态全部失效。')
  } else if (usingWeakSecret) {
    level(`[payload]   原因：${secretProblem}`)
  }
  level('[payload]   注意：生产环境（NODE_ENV=production）不再允许上述回落，会直接退出。')
  level('[payload]   本地演练生产校验：设置 PAYLOAD_REQUIRE_SECRET=1。')
  level(`${banner}\n`)
}

/**
 * 媒体存储 fail-fast（P1）：生产环境必须配齐对象存储环境变量。
 *
 * 未配齐时 plugins 为空数组，media 上传会「静默」落进容器临时磁盘：
 * 后台不报错、图片当场能看，但实例一回收全部丢失（链接集体 404）。
 * 与 PAYLOAD_SECRET 同一策略：config 加载期直接抛错退出，把事故挡在部署阶段，
 * 让平台侧能看到明确崩溃原因而不是留一个迟早爆雷的线上状态。
 * dev / 本地（NODE_ENV 非 production）不受影响，继续用本地磁盘。
 */
if (IS_PRODUCTION && !HAS_S3_CONFIG) {
  const banner = '='.repeat(64)
  console.error(`\n${banner}`)
  console.error('[payload] 生产环境未配置对象存储，拒绝启动')
  console.error('[payload]   原因：SUPABASE_S3_ACCESS_KEY_ID / SUPABASE_S3_SECRET_ACCESS_KEY / SUPABASE_BUCKET 未配齐。')
  console.error('[payload]   后果：图片上传会静默落容器临时盘，实例回收即全部丢失。')
  console.error('[payload]   修复：在部署平台配置上述变量（endpoint 缺省时可从 POSTGRES_URL 的项目 ref 推导）。')
  console.error(`${banner}\n`)
  // 同 PAYLOAD_SECRET 分支：顶层 throw 在 RSC import 上下文可能被 Next 吞成静默白屏，
  // 下一拍强制退出，保证平台记录到非零退出码与明确原因。
  if (!suppressFailFastExit) setTimeout(() => process.exit(1), 0)
  throw new Error('[payload] 生产环境必须配置对象存储（SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY + SUPABASE_BUCKET）')
}

/**
 * 数据库选择：
 *  - 本地/开发：默认 SQLite（单文件，零配置）；如需与线上用同一套数据，设 DATABASE_DRIVER=postgres + POSTGRES_URL
 *  - 上线/EdgeOne：DATABASE_DRIVER=postgres + POSTGRES_URL（指向 Supabase）
 *
 * 切换方法（.env）：
 *   DATABASE_DRIVER=postgres
 *   POSTGRES_URL=postgres://user:pass@host:5432/dbname
 */
const DATABASE_DRIVER = process.env.DATABASE_DRIVER || 'sqlite'

/**
 * Postgres SSL 策略（P0-2，默认严格）：
 *
 *   TLS 行为的全部决策已收敛到 ./lib/pg-tls 的 resolvePgTls()，
 *   这里直接拿到「连接串 + ssl 对象」两件成品，本文件不再自行拼装。
 *
 *   默认：严格校验证书（rejectUnauthorized=true）+ 注入 Supabase 根证书。
 *   安全默认值不能选宽松的一侧 —— 不校验证书时，EdgeOne↔Supabase 之间的
 *   数据库凭据与文章正文可被 TLS 中间人截获。
 *
 *   显式 PG_SSL_INSECURE=1：降级为 rejectUnauthorized=false。
 *   仅用于已知存在自签证书链拦截、且暂时无法拿到有效 CA 的连通性兜底；
 *   上游提供有效 CA 链后应立刻移除该变量回到默认。
 *
 * ⚠️ 为什么不再往连接串里写 sslmode（2026-10-12 全站 500 的根因，别改回去）：
 *   连接串里只要出现 sslmode / sslcert / sslkey / sslrootcert 任意一个，
 *   pg-connection-string 就会把 ssl 整个重置为 {}，注入的 ca 与 rejectUnauthorized
 *   会被静默丢弃。详见 lib/pg-tls.ts 顶部注释。
 */
const PG_SSL_INSECURE = process.env.PG_SSL_INSECURE === '1'

/** 按环境变量选定的数据库适配器（构建时静态选择，两分支均打包） */
// 连接池上限。
//
// ⚠️ 2026-10-22 全站 500 事故：这个值原来生产给 10，配合下面的 idleTimeoutMillis=0
// （永不回收）会把 Supabase 会话池直接打死。会话池对每个项目只分配 pool_size=15 条
// 连接，而 EdgeOne 每个函数实例各有一个 pg.Pool。一次滚动发布同时存在新旧两个实例，
// 2 × 10 = 20 > 15 → 新实例连不上，报
//   (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15
// 而旧实例因为连接永不归还，故障不会自愈。
//
// 生产改成 5：给两个实例留出余量（2 × 5 = 10 < 15），第三个实例也还挤得下。
// 本地仍是 3（单实例、无并发预算压力）。
const PG_POOL_MAX = (() => {
  const raw = Number(process.env.PG_POOL_MAX)
  if (Number.isFinite(raw) && raw > 0) return raw
  return IS_PRODUCTION ? 5 : 3
})()

/**
 * 空闲连接回收时间。
 *
 * 原值写死 0（永不回收），出发点是性能：实测跨公网连东京 Supabase，新建连接要
 * TCP+TLS+认证约 1s，每条查询再付 ~130ms RTT，pg 默认 10s 空闲断连会让停顿后的
 * 每次点击都重付握手费。
 *
 * 但这个取舍在会话池上不成立 —— 详见上面 PG_POOL_MAX 的事故说明：连接不还，
 * 别的实例就拿不到。生产必须给一个有限值：活跃期连接照样复用，静默 30s 后归还，
 * 让滚动发布和冷启动有多余的池子预算。本地仍保留 0（只有一个实例，无竞争）。
 */
const PG_IDLE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PG_IDLE_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw >= 0) return raw
  return IS_PRODUCTION ? 30_000 : 0
})()

/**
 * 建连超时。
 *
 * 池子满时 pg 默认会一直等待，函数实例就那么悬着，最后被平台超时杀掉 ——
 * 表现为请求转圈很久然后 500，日志里还看不到原因。给一个明确的 20s，
 * 超时直接抛错，至少能快速失败并让调用方看到真实错误。
 */
const PG_CONNECT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PG_CONNECT_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw > 0) return raw
  return 20_000
})()

const PG_URL = process.env.POSTGRES_URL

/**
 * 连接串与 ssl 方案一次算清。
 * 注意：返回的 connectionString **已经剔除了全部 ssl* 参数** —— 这是本修复的核心，
 * 原因见文件顶部与 lib/pg-tls.ts 的说明（连接串里的 sslmode 会把 ssl 对象清空，
 * 从而丢掉注入的 CA）。TLS 行为完全由 pgTls.ssl 决定。
 */
const pgTls = resolvePgTls({
  connectionString: PG_URL,
  insecure: PG_SSL_INSECURE,
  caFile: process.env.SUPABASE_CA_FILE,
  localSsl: process.env.PG_LOCAL_SSL === '1',
})

/**
 * 启动期把「实际生效的 SSL 方案」打进平台日志。
 *
 * 2026-10-12 事故里最贵的一步是「猜证书到底有没有生效」——探针只能证明文件在包里，
 * 证明不了它被交给了 pg。这里直接把最终结论打出来，一眼可判：
 *   - strippedQueryKeys 非空 → 说明控制台里的 POSTGRES_URL 自己带了 sslmode 等参数（已自动剔除）
 *   - ca 为「未加载」→ 才是真的缺证书文件
 */
console.log(
  '[payload] Postgres TLS',
  JSON.stringify({
    driver: DATABASE_DRIVER,
    host: pgTls.host ?? '(none)',
    strict: pgTls.strict,
    ssl:
      pgTls.ssl === false
        ? 'off(本机 PG)'
        : pgTls.ssl
          ? `on(rejectUnauthorized=${pgTls.ssl.rejectUnauthorized})`
          : 'off(未配置数据库)',
    strippedQueryKeys: pgTls.strippedQueryKeys,
    ca: pgTls.ca.loaded ? `${pgTls.ca.path} (${pgTls.ca.bytes}B, ${pgTls.ca.blocks} certs)` : '未加载',
    trustStoreCerts: pgTls.trustStoreCerts,
  }),
)

/**
 * 严格模式却没找到 CA 证书时的提醒（非致命，留给 fallback）。
 *
 * 为什么不 fail-fast：本地开发连本机 PG / 用别家库都可能不需要这份证书，
 * 直接 exit 会让正常开发起不来。真正连不上时 Payload 初始化会抛
 * "cannot connect to Postgres: self-signed certificate in certificate chain"，
 * 由 /api/health 直接暴露，比在这里猜测环境更可靠。
 */
if (pgTls.strict && pgTls.host && !pgTls.isLocal && !pgTls.ca.loaded) {
  console.warn(
    '[payload] 未找到 certs/supabase-ca.pem，严格 TLS 下连接 Supabase 可能报 ' +
      '"self-signed certificate in certificate chain"。可用 SUPABASE_CA_FILE 指定路径。',
  )
}

/**
 * 数据库 fail-fast（与 PAYLOAD_SECRET / 对象存储分支同策略）：
 * 生产必须 DATABASE_DRIVER=postgres + POSTGRES_URL。
 * 缺配时静默回落 SQLite 会起一个**空库**：零用户状态下 Payload 内置的
 * POST /api/users/first-register 匿名可达（overrideAccess 绕过 access.create），
 * 任何人可直接创建管理员账号。空 SQLite + 匿名 bootstrap 是提权入口，必须拒启。
 */
if (IS_PRODUCTION && (DATABASE_DRIVER !== 'postgres' || !PG_URL)) {
  const banner = '='.repeat(64)
  console.error(`\n${banner}`)
  console.error('[payload] 生产环境数据库配置不可用，拒绝启动')
  console.error('[payload]   原因：DATABASE_DRIVER 不是 postgres，或 POSTGRES_URL 未配置。')
  console.error('[payload]   后果：回落 SQLite 会是一个空库，first-register 匿名接口可直接建管理员。')
  console.error('[payload]   修复：在部署平台配置 DATABASE_DRIVER=postgres + POSTGRES_URL。')
  console.error(`${banner}\n`)
  // 同 PAYLOAD_SECRET 分支：顶层 throw 在 RSC import 上下文可能被 Next 吞成静默白屏，
  // 下一拍强制退出，保证平台记录到非零退出码与明确原因。
  if (!suppressFailFastExit) setTimeout(() => process.exit(1), 0)
  throw new Error('[payload] 生产环境必须使用 PostgreSQL（DATABASE_DRIVER=postgres + POSTGRES_URL）')
}

const db =
  DATABASE_DRIVER === 'postgres'
    ? postgresAdapter({
        pool: {
          connectionString: pgTls.connectionString,
          // 默认 rejectUnauthorized=true；仅在显式 PG_SSL_INSECURE=1 时关闭校验；本机连接不启用 SSL。
          // ⚠️ 这个 ssl 对象是 TLS 的唯一生效来源。连接串里不得再出现 sslmode/sslrootcert 等参数：
          //    pg 会用连接串的解析结果覆盖它（把 ssl 清成 {}），CA 随之丢失 → 全站 500。
          ssl: pgTls.ssl,
          // ── 连接池常驻配置（连远程库时是性能关键项，本机连接无所谓）──
          // 实测跨公网连东京 Supabase：新建连接要 TCP+TLS+认证约 1s，每条查询再付 ~130ms RTT；
          // 而 pg 默认 10s 空闲就断连 → 停顿后的每次点击都要重付握手费。
          // 但「永不回收」会打死会话池（见文件上方 PG_POOL_MAX 的事故说明），
          // 故生产取 30s：活跃期照样复用，静默半分钟后归还配额。本地仍 0。
          idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
          keepAlive: true, // TCP 保活，及时探测被服务端断开的死连接
          max: PG_POOL_MAX,
          // 池满时不无限等待，20s 内拿不到连接就抛错（默认行为是挂到平台超时）
          connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
        },
        // 默认 push:false。本地现默认连绿色版 PG（.env 里设了 PAYLOAD_FORCE_PUSH=1，可自动同步 schema）；
        // 连线上 Supabase 时（.env.supabase / dev:supabase）必须保持关闭 —— dev push 会直接改生产库
        // schema，并往 payload_migrations 写 batch=-1 的 dev 标记，后续 migrate 会弹交互确认卡死。
        push: process.env.PAYLOAD_FORCE_PUSH === '1',
        // 生产环境（NODE_ENV=production）启动时自动执行未跑的迁移（按 payload_migrations 记录跳过已跑的）。
        // 背景：生产环境 Payload 永远不做 schema push（db-postgres 的 connect 只在非 production 才 push），
        // EdgeOne 部署又没有 migrate 构建步骤，之前 projects 集合上线后线上库从未同步导致 /admin 500。
        // 注意：新增/修改集合后要用 `payload migrate:create` 生成完整迁移（含 locked_documents_rels 的列变更），
        // 部署后这里会在启动时自动补跑。
        prodMigrations: migrations,
      })
    : sqliteAdapter({
        // SQLite 分支仅为本地/开发兜底：feishu_open_id 部分唯一索引迁移只挂 PG（见 20261002 迁移），
        // 生产已由上方 fail-fast 强制 postgres，不会再走到这里。
        client: {
          url: process.env.DATABASE_URL || 'file:./payload.db',
        },
        // 仅当需要接受破坏性 schema 变更时设置（如临时清理表）；
        // 正常环境下保持默认，改动 schema 时由交互式确认保护数据。
        push: process.env.PAYLOAD_FORCE_PUSH === '1',
      })

export default buildConfig({
  admin: {
    user: Users.slug, // 后台登录使用 users 集合
    // 明暗双主题：交给 Payload 内置 ThemeProvider（cookie + html[data-theme]）
    // 'all' = 允许切换；服务端读 cookie，首屏即为正确主题，不会闪白
    theme: 'all',
    // 账号头像：不设这项时 Payload 默认 'gravatar'，会在导航栏渲染
    // <img src="https://www.gravatar.com/avatar/<md5(email)>">。
    // 国内直连 gravatar 会被重置（控制台满屏 net::ERR_CONNECTION_CLOSED），
    // 而 admin-theme.css 只是把 .gravatar-account 隐藏掉 —— 元素还在，请求照发。
    // 顶栏头像实际由自定义 AdminShell（UserCard，读飞书头像）负责，这里用内置
    // 占位图标即可，既没有外网请求也不影响观感。
    avatar: 'default',
    importMap: {
      // 以项目根为基准计算 importMap 相对路径（组件路径为 /src/... 的形式）
      baseDir: path.resolve(dirname, '..'),
    },
    components: {
      // 自定义侧边栏导航：一级分组（总览/创作/管理/系统）+ 二级菜单
      Nav: '/src/admin/components/CustomNav.tsx#CustomNav',
      // 登录页插槽：在账号密码表单上方插入「飞书扫码登录」入口
      // 用于忘记密码兜底场景，也可作为日常登录备选
      beforeLogin: ['/src/admin/components/FeishuLoginLink.tsx#FeishuLoginLink'],
      // 替换 Payload 默认 Logo / Icon 为云字图
      graphics: {
        Logo: '/src/admin/components/CloudGraphics.tsx#CloudLogo',
      },
      // 登录页注入器（品牌文案 / 密码显隐 / 飞书入口归位 / 提交过渡态）
      // AdminShell：全局壳子（固定顶栏 + 多标签 + 命令面板 + 明暗切换）
      providers: [
        '/src/admin/components/LoginBrand.tsx#LoginBrand',
        '/src/admin/shell/AdminShell.tsx#AdminShell',
      ],
      views: {
        // 自定义仪表盘：统计卡片 + 最近内容（数据来自 Payload REST API）
        dashboard: {
          Component: '/src/admin/views/DashboardView.tsx#DashboardView',
        },
        // 自定义账号设置：规整的卡片布局（资料 + 改密码）
        account: {
          Component: '/src/admin/views/AccountView.tsx#AccountView',
        },
        // 创作页：保存草稿 + 发布弹窗（路由 /admin/write-post、/admin/write-note）
        'write-post': {
          Component: '/src/admin/views/write/PostComposeView.tsx#PostComposeView',
          path: '/write-post',
        },
        'write-note': {
          Component: '/src/admin/views/write/NoteComposeView.tsx#NoteComposeView',
          path: '/write-note',
        },
        // 草稿箱：文章/随笔两个 Tab（路由 /admin/drafts）
        drafts: {
          Component: '/src/admin/views/drafts/DraftsView.tsx#DraftsView',
          path: '/drafts',
        },
        // 回收站：软删除文档的恢复/彻底删除（路由 /admin/trash）
        trash: {
          Component: '/src/admin/views/trash/TrashView.tsx#TrashView',
          path: '/trash',
        },
        // 评论管理：审核 Waline 评论（路由 /admin/comments）
        comments: {
          Component: '/src/admin/views/comments/CommentsView.tsx#CommentsView',
          path: '/comments',
        },
        // 工作台：集中处理待审 / 待处理事项（路由 /admin/workbench）
        workbench: {
          Component: '/src/admin/views/workbench/WorkbenchView.tsx#WorkbenchView',
          path: '/workbench',
          meta: { title: '工作台' },
        },
        // 更新日志：GitHub 贡献热力图 + 三个仓库的近期提交（路由 /admin/changelog）
        changelog: {
          Component: '/src/admin/views/changelog/ChangelogView.tsx#ChangelogView',
          path: '/changelog',
          // 浏览器标签标题（否则回落到「Payload - Payload」）
          meta: { title: '更新日志' },
        },
      },
    },
    // 自定义 favicon（浏览器标签页图标，统一使用透明底深色云）
    meta: {
      icons: [
        { url: '/cloud-icons/cloud-dark.png', rel: 'icon', type: 'image/png', sizes: '32x32' },
        { url: '/cloud-icons/cloud-dark.png', rel: 'icon', type: 'image/png', sizes: '32x32', media: '(prefers-color-scheme: dark)' },
      ],
    },
    // 全局日期格式：年月日全部用阿拉伯数字，例如 2026-08-25
    dateFormat: 'yyyy-MM-dd',
  },
  // 后台界面语言：固定为简体中文
  i18n: {
    fallbackLanguage: 'zh',
    supportedLanguages: { zh },
  },
  // 数据模型：文章、随笔、分类、标签、图片、用户 + 站点设置/导航管理单例
  collections: [Posts, Notes, Categories, Tags, Media, Projects, Users],
  globals: [SiteSettings, Navigation],
  // 富文本编辑器
  editor: lexicalEditor(),
  // 加密密钥（必须与 .env 中的 PAYLOAD_SECRET 一致，上方已校验非空）
  secret: payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // 数据库：由上方环境变量动态选择（默认 SQLite 单文件库）
  db,
  sharp,
  // 对象存储插件：Supabase Storage 接入（未配置 S3_* 时为空数组，走本地磁盘）
  plugins,
})
