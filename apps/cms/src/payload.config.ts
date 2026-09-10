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
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { Navigation } from './globals/Navigation'
import { SiteSettings } from './globals/SiteSettings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * 数据库选择：
 *  - 开发/本地：默认 SQLite（零安装、单文件，无需额外服务）
 *  - 上线/VPS：通过环境变量切换到 PostgreSQL 等托管数据库
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
          connectionString: process.env.POSTGRES_URL,
          // EdgeOne 出口网络存在 TLS 拦截（自签证书链），关闭证书校验避免 SELF_SIGNED_CERT_IN_CHAIN
          // 连接本身仍是 TLS 加密的，只是不再校验证书链
          ssl: { rejectUnauthorized: false },
        },
        // 与 sqlite 分支一致：PAYLOAD_FORCE_PUSH=1 时非交互建表（用于首次切换到线上库）
        push: process.env.PAYLOAD_FORCE_PUSH === '1',
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
  collections: [Posts, Notes, Categories, Tags, Media, Users],
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
