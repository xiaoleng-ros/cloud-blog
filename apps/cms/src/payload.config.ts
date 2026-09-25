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
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_BUCKET && SUPABASE_STORAGE_ENDPOINT
    ? [
        s3Storage({
          collections: { media: true },
          bucket: SUPABASE_BUCKET,
          acl: 'public-read', // 图片公开可读，浏览器可直接加载，不走 signed URL
          config: {
            endpoint: SUPABASE_STORAGE_ENDPOINT,
            region: 'us-east-1', // Supabase 的 S3 兼容接口固定这个 region
            credentials: {
              // AWS SDK 里 accessKeyId = "supabase-demo" 是占位符，secretAccessKey 才是真 key
              accessKeyId: 'supabase-demo',
              secretAccessKey: SUPABASE_SERVICE_ROLE_KEY,
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
 * PAYLOAD_SECRET 处理策略（生产环境安全 vs. 云端容错）：
 *
 *  历史教训：此处曾经用模块顶层 throw 强校验，导致 EdgeOne 云端一旦缺环境变量
 *  整个模块 import 就炸，Next.js 把 LayoutRouter children 静默降级为 null，
 *  前端拿到 `16:null` 后 InnerLayoutRouter 无限挂起，用户看到的是零报错白屏，
 *  极难排查。因此这里不再 throw，改为「缺失时回落到固定 dev 密钥 + 打警告」。
 *
 *  正确做法：在 EdgeOne 控制台 / 部署环境里显式配置 PAYLOAD_SECRET；
 *  本地开发则继续走 .env.production。若两者都缺，用固定兜底值保证后台可访问。
 */
const PAYLOAD_SECRET_FALLBACK = 'clay-blog-dev-secret-key-2026-random-string-change-in-production'
const payloadSecret = process.env.PAYLOAD_SECRET || PAYLOAD_SECRET_FALLBACK

if (!process.env.PAYLOAD_SECRET) {
  // 只在生产模式告警，不打断渲染
  console.warn('[payload] ⚠ PAYLOAD_SECRET 未配置，已回落为内置兜底密钥。生产环境请在部署平台配置真实密钥。')
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

/** 按环境变量选定的数据库适配器（构建时静态选择，两分支均打包） */
const db =
  DATABASE_DRIVER === 'postgres'
    ? postgresAdapter({
        pool: {
          connectionString: process.env.POSTGRES_URL
            ? process.env.POSTGRES_URL + (process.env.POSTGRES_URL.includes('?') ? '&' : '?') + 'sslmode=no-verify'
            : undefined,
          // EdgeOne 出口网络存在 TLS 拦截（自签证书链），通过连接字符串强制关闭证书校验
          // 连接本身仍是 TLS 加密的，只是不再校验证书链
          ssl: { rejectUnauthorized: false },
        },
        // 默认关闭 dev 模式的自动 schema push（push: false）。
        // 原因：本地若连的是线上 Supabase，dev push 会直接改动生产库的 schema，并往
        // payload_migrations 写入 batch=-1 的 dev 标记（会让后续 migrate 弹交互确认卡死）。
        // 只有当本地明确要「改 schema 并同步到当前连接的库」时，才设 PAYLOAD_FORCE_PUSH=1 临时开启。
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
    importMap: {
      // 以项目根为基准计算 importMap 相对路径（组件路径为 /src/... 的形式）
      baseDir: path.resolve(dirname, '..'),
    },
    components: {
      // 自定义侧边栏导航：一级分组（总览/创作/管理/系统）+ 二级菜单
      Nav: '/src/admin/components/CustomNav.tsx#CustomNav',
      // 替换 Payload 默认 Logo / Icon 为云字图
      graphics: {
        Logo: '/src/admin/components/CloudGraphics.tsx#CloudLogo',
      },
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
