// 注意：两个数据库适配器都必须静态导入，让 webpack 打包进产物。
// 之前用动态 import + webpackIgnore 导致包不进产物，EdgeOne 运行时报 ERR_MODULE_NOT_FOUND。
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { zh } from '@payloadcms/translations/languages/zh'
import path from 'path'
import { buildConfig } from 'payload'
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
  // 加密密钥（必须与 .env 中的 PAYLOAD_SECRET 一致）
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // 数据库：由上方环境变量动态选择（默认 SQLite 单文件库）
  db,
  sharp,
})
