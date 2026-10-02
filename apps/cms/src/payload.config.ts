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

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * 对象存储（图片上传）：
 *  - 只要配齐 SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET 就启用 S3 adapter
 *    走 Supabase Storage（S3 兼容接口），文件不再落容器本地磁盘
 *  - 未配置时降级为本地磁盘存储（开发环境默认）
 *
 * 生产环境（EdgeOne）必须配置以下环境变量：
 *   SUPABASE_SERVICE_ROLE_KEY  —— Supabase Dashboard → Project Settings → API → service_role key
 *                                  （注意是 service_role，不是 anon key；service_role 绕过 RLS 直接读写）
 *   SUPABASE_BUCKET            —— Storage 里创建的 bucket 名（建议 "blog-media"）
 *   SUPABASE_STORAGE_ENDPOINT  —— 一般不用改，默认从 POSTGRES_URL 里的 project ref 拼
 *                                  例：https://<ref>.supabase.co/storage/v1
 */
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET
const SUPABASE_STORAGE_ENDPOINT =
  process.env.SUPABASE_STORAGE_ENDPOINT ||
  (process.env.POSTGRES_URL?.includes('.supabase.com')
    ? `https://${new URL(process.env.POSTGRES_URL).hostname.split('.')[0]}.supabase.co/storage/v1`
    : undefined)

/** S3/Supabase 对象存储凭据是否配齐（缺任何一项都不注入 s3Storage 插件） */
const HAS_S3_CONFIG = Boolean(SUPABASE_SERVICE_ROLE_KEY && SUPABASE_BUCKET && SUPABASE_STORAGE_ENDPOINT)

/**
 * 组装插件列表：仅当 S3 凭据齐全时注入 s3Storage。
 *
 * ⚠ 重要：插件开关由环境变量决定，但后台的组件映射表 `src/app/(payload)/admin/importMap.js`
 * 是构建期静态文件（`next build` 不会重新生成它）。一旦插件被激活却在 importMap 里
 * 找不到 `@payloadcms/storage-s3/client#S3ClientUploadHandler`，Payload 后台会「静默空白」：
 * 页面 200、CSS/JS 全部加载成功、控制台零报错，但 body 内没有任何元素和文字。
 * 因此改动这里的环境变量判断后，必须带同样的环境变量跑一次 `npm run generate:importmap`
 * 并提交 importMap.js（当前仓库已提交含该条目的版本，激活/未激活都不会再空白）。
 *
 * 类型断言说明：s3Storage(...) 通过 declare module 'payload' 扩展了 ConfigureAppOptions，
 * 本地 tsc 能识别，但 EdgeOne 编译链可能不加载该 augmentation，会误报
 * "Property 's3Storage' does not exist on type 'ConfigureAppOptions'"。
 * 用 `as unknown as Plugin` 强制收敛，运行时行为完全不变。
 */
const plugins: Plugin[] =
  HAS_S3_CONFIG
    ? [
        // HAS_S3_CONFIG 已保证三项 env 均非空，但 TS 无法据此收窄 process.env 类型，
        // 故此处用非空断言。
        s3Storage({
          collections: { media: true },
          bucket: SUPABASE_BUCKET!,
          acl: 'public-read', // 图片公开可读，浏览器可直接加载，不走 signed URL
          config: {
            endpoint: SUPABASE_STORAGE_ENDPOINT!,
            region: 'us-east-1', // Supabase 的 S3 兼容接口固定这个 region
            credentials: {
              // AWS SDK 里 accessKeyId = "supabase-demo" 是占位符，secretAccessKey 才是真 key
              accessKeyId: 'supabase-demo',
              secretAccessKey: SUPABASE_SERVICE_ROLE_KEY!,
            },
            // 注：Supabase Storage 兼容模式使用 v4 签名，AWS SDK 默认即 v4，无需显式配置
            // forcePathStyle: false → bucket 走虚拟主机样式（<bucket>.<endpoint>），
            // Supabase Storage 兼容模式要求这个
            forcePathStyle: false,
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

if (secretProblem && mustHardFail) {
  const banner = '='.repeat(64)
  console.error(`\n${banner}`)
  console.error('[payload] PAYLOAD_SECRET 不可用，拒绝启动')
  console.error(`[payload]   原因：${secretProblem}`)
  console.error('[payload]   修复：在部署平台配置 PAYLOAD_SECRET（>= 32 字符随机字符串）。')
  console.error(`${banner}\n`)
  // 顶层 throw 在 RSC import 上下文里可能被 Next 吞成静默白屏，
  // 因此下一拍强制退出，让平台侧能看到明确的崩溃原因。
  setTimeout(() => process.exit(1), 0)
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
  console.error('[payload]   原因：SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET / SUPABASE_STORAGE_ENDPOINT 未配齐。')
  console.error('[payload]   后果：图片上传会静默落容器临时盘，实例回收即全部丢失。')
  console.error('[payload]   修复：在部署平台配置上述变量（endpoint 缺省时可从 POSTGRES_URL 的项目 ref 推导）。')
  console.error(`${banner}\n`)
  // 同 PAYLOAD_SECRET 分支：顶层 throw 在 RSC import 上下文可能被 Next 吞成静默白屏，
  // 下一拍强制退出，保证平台记录到非零退出码与明确原因。
  setTimeout(() => process.exit(1), 0)
  throw new Error('[payload] 生产环境必须配置对象存储（SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET）')
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
 * Postgres SSL 策略（P0-2，默认改为严格）：
 *
 *   默认（未设置任何开关）：sslmode=prefer + rejectUnauthorized=true。
 *   安全默认值不能选宽松的一侧 —— 不校验证书时，EdgeOne↔Supabase 之间的
 *   数据库凭据与文章正文可被 TLS 中间人截获。
 *
 *   显式 PG_SSL_INSECURE=1：降级为 sslmode=no-verify + rejectUnauthorized=false。
 *   仅用于已知存在自签证书链拦截、且暂时无法拿到有效 CA 的连通性兜底；
 *   上游提供有效 CA 链后应立刻移除该变量回到默认。
 */
const PG_SSL_INSECURE = process.env.PG_SSL_INSECURE === '1'
const PG_SSL_STRICT = !PG_SSL_INSECURE

/**
 * 本地绿色版 PG（127.0.0.1 / localhost / ::1）默认没开 SSL。
 * 只要 ssl 配置对象非 undefined，pg 就会坚持完成 TLS 协商（即使 URL 写 sslmode=prefer
 * 也会直接报 "The server does not support SSL connections"），所以本机连接要把 ssl 置为 false。
 * 若要给本地 PG 开 SSL，设 PG_LOCAL_SSL=1 走原来的严格校验分支。
 */
function isLocalPg(connectionString?: string): boolean {
  if (!connectionString) return false
  try {
    const host = new URL(connectionString).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/**
 * 拼接/替换 sslmode 查询参数
 * 已有 sslmode 时替换为新值（.env.production 常写 sslmode=no-verify，严格模式需覆盖）
 * 实现：拆分 base?query 两段，重写 sslmode 参数，避免 regex 边界判断出错
 */
function withSslMode(connectionString: string, strict: boolean): string {
  const mode = strict ? 'sslmode=prefer' : 'sslmode=no-verify'
  const qIndex = connectionString.indexOf('?')
  const base = qIndex === -1 ? connectionString : connectionString.slice(0, qIndex)
  const rawQuery = qIndex === -1 ? '' : connectionString.slice(qIndex + 1)

  // 过滤掉已有的 sslmode 参数（忽略大小写）
  const params = rawQuery
    .split('&')
    .filter(Boolean)
    .filter((p) => !/^sslmode=/i.test(p))

  const nextParams = [...params, mode]
  return `${base}?${nextParams.join('&')}`
}

/** 按环境变量选定的数据库适配器（构建时静态选择，两分支均打包） */
// 连接池上限。历史原因：本地曾直连线上 Supabase 会话池（5432），每条池连接都对应
// 服务端真实进程，dev 开满会和线上抢连接预算，所以 dev 压到 3。
// 现在本地默认连 D:\pglocal 的绿色版 PG，不再有这个约束；上限沿用 dev 3 足够，
// 需要本地并发压测时显式设 PG_POOL_MAX。
const PG_POOL_MAX = (() => {
  const raw = Number(process.env.PG_POOL_MAX)
  if (Number.isFinite(raw) && raw > 0) return raw
  return IS_PRODUCTION ? 10 : 3
})()

const PG_URL = process.env.POSTGRES_URL
const PG_IS_LOCAL = isLocalPg(PG_URL) && process.env.PG_LOCAL_SSL !== '1'
// 本机连接不带 ssl 参数，也不强制 sslmode；远程才按严格/降级策略重写 sslmode。
const pgConnectionString = PG_URL && !PG_IS_LOCAL ? withSslMode(PG_URL, PG_SSL_STRICT) : PG_URL
const pgSsl: false | { rejectUnauthorized: boolean } | undefined = PG_IS_LOCAL
  ? false
  : PG_URL
    ? { rejectUnauthorized: PG_SSL_STRICT }
    : undefined

const db =
  DATABASE_DRIVER === 'postgres'
    ? postgresAdapter({
        pool: {
          connectionString: pgConnectionString,
          // 默认 rejectUnauthorized=true；仅在显式 PG_SSL_INSECURE=1 时关闭校验；本机连接不启用 SSL。
          ssl: pgSsl,
          // ── 连接池常驻配置（连远程库时是性能关键项，本机连接无所谓）──
          // 实测跨公网连东京 Supabase：新建连接要 TCP+TLS+认证约 1s，每条查询再付 ~130ms RTT；
          // 而 pg 默认 10s 空闲就断连 → 停顿后的每次点击都要重付握手费。
          // 关闭空闲回收 + 开启 TCP 保活，让连接建立后长期复用。
          idleTimeoutMillis: 0, // 0 = 永不因空闲回收连接（常驻连接池）
          keepAlive: true, // TCP 保活，及时探测被服务端断开的死连接
          max: PG_POOL_MAX,
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
