# 01 · 全仓库只读审计

> 审计日期：2026-10-09 · 审计范围：`apps/blog`（Astro 7 前台）、`apps/cms`（Payload CMS 3 + Next.js 后台）、`shared/`、根编排脚本。
> 口径：只读审计，不修改任何业务文件；所有结论均基于实际文件路径，未确认的信息明确标注「待确认」。

## 1. 技术栈与版本清单

| 项 | 实际值 | 出处 |
| --- | --- | --- |
| 前台框架 | Astro 7.2（默认 **static 输出**，无 adapter；重定向 `/projects → /about`） | `apps/blog/package.json`、`apps/blog/astro.config.mjs` |
| 后台框架 | Payload CMS 3.88 + Next.js 16.3.8（SSR，`force-dynamic` catch-all） | `apps/cms/package.json`、`apps/cms/next.config.mjs` |
| 语言 | TypeScript 5.7（两端） | 各 `package.json` |
| 数据库 | Postgres（本地绿色版 `D:\pglocal:5433/blog_dev`；生产托管库）；SQLite 仅作历史保留 | `apps/cms/src/payload.config.ts:250,345-370` |
| 图片存储 | Supabase Storage（S3 协议）；凭据不齐备时回退本地磁盘 | `apps/cms/src/payload.config.ts:101-135` |
| 评论 | Waline 进程内接管（`/api/waline/*`，127.0.0.1 随机端口桥接） | `apps/cms/src/app/api/waline/[[...path]]/route.ts`、`src/lib/waline-bridge.ts` |
| 部署 | EdgeOne Makers 单项目一体化（根目录 `apps/cms`，前后台同域） | `apps/cms/edgeone.json`、README |
| 校验手段 | `astro check`（blog）、`tsc`（cms）、`scripts/verify-html-inject.mjs`（15 例断言）；**无单元测试框架、无 lint** | 两端 `package.json` |

> 注：README 徽章写 `Next.js-15`，实际依赖为 `next 16.3.8`（CVE-2026-75604 修复升级）。徽章属过期信息，已列入待清理项。

## 2. 真实路由与页面模块

### 前台 `apps/blog/src/pages/**`（构建期静态生成）

| 路由 | 文件 | 页面模块 |
| --- | --- | --- |
| `/` | `index.astro` | Hero 卡、精选列表、最新文章列表、侧栏站点运行时间卡 |
| `/posts/{分类}/{id}/` | `posts/[...slug].astro` | 文章头、正文、目录、相邻/相关、评论区、JSON-LD |
| `/posts/{id}/`（历史） | 同上 | 由 cms catch-all 301 到新路径 |
| `/notes/` | `notes.astro` | 随笔流、年月时间索引、评论区 |
| `/archive/`、`/archive/{n}/` | `archive/[...page].astro` | 归档头、统计、按年列表、分页（每页 5 篇） |
| `/categories/{category}/` | `categories/[category].astro` | 词条切换、计数、文章列表 |
| `/tags/` | `tags/index.astro` | 标签墙 |
| `/tags/{tag}/` | `tags/[tag].astro` | 词条切换、计数、文章列表 |
| `/stats/` | `stats.astro` | 统计卡、分类环形图、年份分布、运行天数行 |
| `/about/` | `about.astro` | 个人便签、技能环、项目分组 |
| `/search/` | `search.astro` | 客户端搜索（读 `site-index.json`，`lib/search-match.ts` 打分） |
| `/404` | `404.astro` | 空态页 |
| 端点 | `rss.xml.ts`、`sitemap.xml.ts`、`robots.txt.ts`、`site-index.json.ts` | 派生输出 |

### 后台 `apps/cms/src/app/**`

- `/admin/*`：Payload 后台（自定义 Nav/壳子/写文章/草稿箱/回收站/评论管理/站点设置等视图）
- `/api/*`：Payload 原生 REST；`/api/blog-sync`（版本探测 + 按路径返回区块 HTML）、`/api/blog-sync/stream`（SSE）、`/api/waline/*`（评论）、`/api/comments(+[id])`（评论管理，登录）、`/api/change-password`（登录+同源）、`/api/feishu/{redirect,callback,bind}`
- `[[...path]]` catch-all：先查 `public/__blog/` 静态外壳，再用 `blog-render` 注入最新区块并返回（`lib/html-inject.ts`）
- `/(payload)/api/[...slug]`、`/(payload)/graphql`：Payload 透传

## 3. 页面 → 字段 → 数据来源（摘要，完整表见 03-data-mapping.md）

| 页面 | 展示字段 | 来源 |
| --- | --- | --- |
| `/` | Hero 文案、社交链接、品牌名 | `site-settings` global（缺失时回退 `site-defaults` 离线兜底） |
| `/` | 文章卡片与精选（title/date/cover/coverAlt/categories/tags/description/ai/sticky） | `posts` 集合（loader 写入 content collection） |
| `/` | 站点运行时间 | **当前为占位常量 `PLACEHOLDER_SITE_SINCE`，未读取 `site-settings.siteCreatedAt`（本次修复）** |
| 文章详情 | 全字段 + 正文 Markdown | `posts` 集合；派生：阅读时长、目录、相邻、相关、JSON-LD |
| `/notes/` | date/title/mood/tags/body | `notes` 集合；年月索引为派生 |
| `/archive/`、词条页、`/tags/`、`/stats/` | 统计与年份 | `posts` 集合 + `shared/site-stats.ts` 派生 |
| `/about/` | about 文案/便签/技能 | `site-settings` global（`shared/about-format.ts` 解析） |
| `/about/` | 项目分组卡片 | `projects` 集合 |
| 端点（RSS/sitemap/site-index） | 汇总 | 各集合 + `getNavItems()` |

## 4. 硬编码数据、重复实现与不一致清单

### 业务数据仍写死在代码中（本轮处置）

| # | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| 1 | `apps/blog/src/components/SiteAge.astro:8`、`apps/blog/src/pages/stats.astro:14` | 运行时间起始日写死 `PLACEHOLDER_SITE_SINCE`；后台 `siteCreatedAt` 字段已存在但前台从未读取 | **修复：接线到后台（留空不渲染，后台不可用才用离线兜底）** |
| 2 | `apps/blog/src/lib/constants.ts` | 全文件零引用（BaseLayout 内联同值常量） | **删除** |
| 3 | `shared/html-safety.ts:140` `sanitizeInlineHtml`、`shared/rehype-img-attrs.mjs:38` `getAltMap` | 零调用（已被更严的解析链取代） | **删除** |
| 4 | `icon` 默认值 `'github'` 三处重复：`apps/blog/src/content.config.ts:60`、`apps/blog/src/lib/payload-api.ts:363`、`apps/cms/src/lib/blog-sync.ts:280` | 同一兜底语义分散三处 | **收敛为 shared 常量单一来源** |
| 5 | 锚点 id 双份实现：`notes.astro:32-42` ↔ `apps/blog/src/lib/site-index.ts:60-75`；`about.astro:31-37` ↔ `site-index.ts:78-92` | 注释自称「同源」，双份实现有走偏风险（搜索深链断裂） | **抽取为单一实现** |
| 6 | `apps/cms/package.json` description 仍写「SQLite」；README 徽章 `Next.js-15` | 过期描述 | **更新** |

### 保留现状（有明确理由）

| 位置 | 说明 |
| --- | --- |
| `'uncategorized'`（`apps/blog/src/lib/posts.ts:46`、`apps/cms/src/lib/blog-sync.ts:75,80`、`blog-render.tsx:109`）vs `'未分类'`（`shared/site-stats.ts:64`） | 前者是 URL 路径兜底段（三处一致），后者仅统计展示兜底；分类为必填字段，该兜底实际不可达；URL 用 ASCII、展示用中文属合理约定 |
| `Nav.astro:29-33` MORE_ITEMS（`/stats/`、`/tags/`、GitHub）、`site-index.ts:98-101` EXTRA_PAGES | 站内固定路由属前端结构常量，不是需要动态维护的业务数据；GitHub 链接已跟随后台社交链接，不重复维护 |
| `MOOD` 表（`notes.astro:55-72`）、TAG/CATEGORY 配色、默认封面/OG、音乐 API 兜底 | 纯 UI 映射与视觉常量，按方案「不要把纯视觉样式改成后台字段」保留 |
| `shared/site-defaults.ts` 的 `OFFLINE_*` | 「填了才显示」规则：只在后台整体不可用（`settings === null`）时兜底 |
| `apps/blog/dev-fixtures/*.json` | 仅 dev 环境加载的假数据（构建不读），属开发辅助 |
| 根目录 `admin.html`、`animals.png` | 未跟踪、零引用；来源不明的用户文件，不擅自删除 |

## 5. 已有 Payload 模型及使用位置

Collections（`apps/cms/src/collections/`，均无 versions/drafts）：

| 集合 | 关键字段 | 前台消费位置 |
| --- | --- | --- |
| `posts` | title、description、cover、categories(关系,必填)、tags、keywords、ai、sticky、status(默认 draft)、content(Markdown)；trash 软删 | 首页/文章页/归档/词条页/统计/RSS/sitemap/搜索索引 |
| `notes` | date(必填)、title、mood、categories(必填)、tags、status、content；trash | 随笔页/统计/搜索索引 |
| `projects` | group/title(必填)、icon(默认 github)、href/articleHref(协议白名单)、description、stars、tags、sortOrder、status；defaultSort=group | 关于页项目分组 / 搜索索引 |
| `categories` | name/slug/nodeType/parent(自关联)/sort/visible；防环校验；删除保护 | 分类页路由与导航（经 posts 关系） |
| `tags` | name/slug | 标签页 / 标签墙 |
| `media` | upload 本地或 S3；alt；10MB/4000 万像素限制 | 封面/图标/正文图片（alt 映射注入） |
| `users` | auth sessions、飞书绑定；管理员白名单 | 后台登录 |

Globals（`apps/cms/src/globals/`）：

| Global | 字段 | 前台消费位置 |
| --- | --- | --- |
| `site-settings` | siteName(必填)/siteIcon/siteIcp/**siteCreatedAt**/githubUser/githubRepo/neteasePlaylistId、Hero 五字段、socials、footer 三字段、about 四字段 | 全站布局/导航/页脚/首页 Hero/关于页/运行时间（本次接线） |
| `navigation` | navItems(textarea，每行一项) | 顶栏导航 |

权限模型：匿名仅可读 `published` 内容（`lib/access.ts` 在 REST/GraphQL 出口过滤，trash 集合附带 `deletedAt exists:false`）；`categories/tags/media/两个 global` 公开读；写操作一律需登录（users 集合匿名 create 被 `beforeOperation` 拦截）。

## 6. Node.js 模块的实际职责

本项目**没有独立的 Node.js 后端服务**，不存在与 Payload 重复的 CRUD 接口。业务服务端逻辑全部收敛在 `apps/cms` 的 Next.js route handlers：

| 模块 | 职责 |
| --- | --- |
| `lib/blog-sync.ts` | 构建期/注入期的数据层：并行拉取 6 路数据、5s TTL 快照 + single-flight、版本/指纹计算 |
| `lib/sync-cache.ts` | 快照与区块 LRU 缓存、`invalidateAll`、SSE 客户端注册/广播（状态挂 `globalThis`） |
| `lib/blog-render.tsx` | 按路径渲染区块 HTML（与 blog 组件镜像的渲染层），Markdown 经净化 + shiki |
| `lib/html-inject.ts` | parse5 切片，把最新区块注入静态外壳 |
| `src/app/api/blog-sync/*` | 版本探测 / 区块获取 / SSE 流（匿名公开，只读） |
| `api/waline/*`、`api/comments/*` | 评论写入（Waline 自身鉴权）与后台管理（登录+同源） |
| `api/feishu/*`、`api/change-password` | 登录生态 |

**结论：符合方案「不要为了 CRUD 再造一层与 Payload 重复的接口」。**

## 7. 前台页面 ↔ 后台模型完整映射

见 `docs/refactor/03-data-mapping.md`（页面/模块/字段/当前来源/目标模型/维护入口 六列全表）。

## 8. 风险、未知与待确认

1. **siteCreatedAt 语义变化（已实施，需知悉）**：接线后「后台可用但字段留空 → 首页运行时间卡与统计页运行天数行整块消失」，符合全站「填了才显示」规则；后台整体不可用时仍走离线兜底。
2. **无历史版本能力**：集合未启用 Payload versions/drafts，撤回 = 把 `status` 改回 `draft`；无版本回溯。方案未强制要求，记录为限制。
3. **Serverless 多实例一致性**：SSE 与内存缓存为单实例级，多实例靠 5s TTL 快照 + 前台 30s 轮询兜底，最终一致（README 已文档化）。
4. **未配置 cors/csrf/serverURL**：依赖同域部署 + Payload 默认防护；若未来跨域部署需补配置。（待确认，非当前风险）
5. **本地开发依赖 `D:\pglocal` 绿色版 PG**：仅本机路径，CI/他人机器需自配（`apps/cms/scripts/pg.mjs`）。
6. **构建期缓存/外链**：与本次重构无关，未审计部署平台级 CDN 行为。

