<div align="center">

# ☁️ cloud-blog · 云岫的博客

**一个「前台 + 后台」双应用的 Monorepo** — 用 Astro 🌠 做站点，用 Payload CMS 💼 管内容。

![Astro](https://img.shields.io/badge/Astro-7.0-orange?logo=astro&logoColor=ff5d01)
![Payload](https://img.shields.io/badge/Payload-3.9-gray?logo=payload&logoColor=ffffff)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?logo=opensourceinitiative&logoColor=white)

**✨ 一条命令搞定发布 ✨**

</div>

---

## 🧬 仓库速览

两个应用相互独立、各自带 `package.json` 与 lockfile，可**在 EdgeOne Makers 中分别建成两个独立项目**部署：

| 📦 目录 | 🚀 应用 | 🧰 技术栈 | 💡 说明 |
| --- | --- | --- | --- |
| `apps/blog` | 博客前端 | 🌠 Astro 7（静态站） | 文章 / 随笔 / 归档 / 搜索 / RSS / 关于页，构建时从后台拉取内容 |
| `apps/cms` | 内容后台 | 💼 Payload CMS 3 + Next.js 15 | 文章 / 随笔 / 项目 / 分类标签 / 站点设置 / 导航管理，是内容的**唯一数据源** |

```
cloud/
├── 📦 apps/
│   ├── 🌠 blog/                    # → EdgeOne Makers 项目 1（站点）
│   │   ├── astro.config.mjs                    # Astro 配置（含 payload-hot-reload）
│   │   ├── src/                                # 页面 / 组件 / content collections / 样式
│   │   │   ├── content.config.ts               # posts / notes / projects 集合定义
│   │   │   └── lib/
│   │   │       ├── payload-api.ts              # 后台 REST 客户端（文章/随笔/项目/设置/导航）
│   │   │       ├── payload-loader.ts           # Astro loader：从后台载入并轮询变化
│   │   │       ├── site-defaults.ts            # 站点默认值（后台缺失时兜底）
│   │   │       ├── site-settings.ts            # 从后台读取站点设置
│   │   │       └── posts.ts                    # 站点信息与文章排序等工具
│   │   ├── public/                             # 静态资源
│   │   ├── patches/                            # astro 本地开发补丁（中文路径编码）
│   │   ├── package.json                        # 独立依赖 + lockfile
│   │   ├── .env.example                        # 站点环境变量示例
│   │   └── README.md                           # 博客使用说明
│   └── 💼 cms/                     # → EdgeOne Makers 项目 2（后台）
│       ├── src/payload.config.ts               # Payload 主配置
│       ├── src/collections/                    # Posts / Notes / Projects / Categories / Tags / Media / Users
│       ├── src/globals/                        # SiteSettings / Navigation
│       ├── src/lib/                            # blog-render（区块渲染）/ blog-sync（数据同步）/ sync-cache
│       ├── src/app/api/                        # blog-sync（版本探测+全量区块）/ blog-sync/stream（SSE）
│       ├── src/migrations/                     # Postgres 迁移（含 projects 集合）
│       ├── next.config.mjs
│       ├── scripts/                            # copy-blog-to-public / warmup 等
│       ├── package.json                        # 独立依赖 + lockfile
│       └── tsconfig.json
├── 📄 package.json                # 根编排脚本（私有，无第三方依赖）
├── 📌 .gitignore
└── 📜 LICENSE
```

---

## 🏗️ 内容架构

> [!IMPORTANT]
> 写博客的**所有内容都放进后台**，前台**不再维护本地 Markdown / JSON 数据**。

- 🗄️ **数据源**：`apps/cms` 的 Payload 集合是唯一事实来源 — 文章（Posts）、随笔（Notes）、项目（Projects）、分类（Categories）、标签（Tags），外加两个全局：站点设置（SiteSettings）与导航（Navigation）。
- 📡 **前台取数**：`apps/blog` 通过 Astro content loader（`payload-loader.ts`）在构建 / 开发时从后台 REST API 拉取 posts / notes / projects；站点名称、描述、作者在后台缺失时回退到 `lib/site-defaults.ts` 的默认值。
- 🧩 **关于页项目**：开源项目与资源下载卡片全部来自后台 `projects` 集合（按 `group` 分组聚合），不再依赖 GitHub API 构建时抓取或本地缓存 JSON。
- 🔥 **运行时热同步**：后台数据变更后，前台已打开的页面借助 SSE（`/api/blog-sync/stream`）近实时收到 `update` 事件，或用轮询兜底（`/api/blog-sync?version=1` 版本探测 + 全量区块），局部替换带 `data-sync-block` 锚点的区块，实现「后台改 → 前台数秒内自动更新」。

```mermaid
flowchart LR
  B[💼 Payload CMS 后台] -->|SSE / 轮询| D[🌐 浏览器页面]
  B -->|loader 构建时取数| A[🌠 Astro 前端]
  A -->|静态构建| D
  A -.->|运行时 /api/blog-sync| B
```

---

## 🚀 本地开发

> [!TIP]
> 前端会优先从后台取数；**同时启动两个应用**才能看到完整内容。

```bash
# 🛠️ 首次：分别安装两个应用的依赖
npm run setup

# 🖥️ 终端 1：博客前端 → http://localhost:4321
npm run dev:blog

# 🗄️ 终端 2：内容后台 → http://localhost:9527  （默认 SQLite，零配置）
npm run dev:cms
```

- 📡 前端构建/开发时从后台 API（`PUBLIC_PAYLOAD_URL`，默认 `http://localhost:9527`）拉取内容；**后台未运行时文章/随笔/项目为空**，但页面仍可正常访问（站点默认值兜底）。
- ⚡ 开发期后台数据变更会热同步到前台页面（`payload-hot-reload`：loader 检测变化后 touch 标记文件并广播整页刷新；生产走 SSE + 轮询）。各应用详情见 `apps/blog/README.md`、`apps/cms/package.json`。

---

## 🗝️ 环境变量

`apps/blog/.env`（参考 `apps/blog/.env.example`）：

| 🎛️ 变量 | 💡 用途 |
| --- | --- |
| `SITE_URL` | 站点正式域名（RSS / sitemap / canonical） |
| `PUBLIC_PAYLOAD_URL` | Payload 后台地址，默认 `http://localhost:9527` |
| `PUBLIC_TWIKOO_ENV_ID` | Twikoo 评论后端，不配则评论隐藏 |
| `PUBLIC_NETEASE_PLAYLIST_ID` / `PUBLIC_MUSIC_API` | 🎵 音乐播放器歌单 |

`apps/cms` 生产环境变量（本地 SQLite 无需配置）：

| 🎛️ 变量 | 💡 用途 |
| --- | --- |
| `DATABASE_DRIVER` | `sqlite`（默认）/ `postgres` |
| `POSTGRES_URL` | `postgres` 时的连接串（如 Neon） |
| `PAYLOAD_SECRET` | Payload 加密密钥（生产必填） |
| `PAYLOAD_FORCE_PUSH=1` | 首次向线上库非交互建表 |

---

## 🚢 部署到 EdgeOne Makers

可在 EdgeOne Makers（控制台 → EdgeOne → Makers）中创建 **两个相互独立的项目**，同一仓库、不同根目录：

| 📦 项目 | 🧭 仓库根目录 | 🧰 类型 | 🔧 构建命令 | 📂 输出目录 |
| --- | --- | --- | --- | --- |
| 博客站点 | `apps/blog` | 静态站（Astro） | `npm install && npm run build` | `dist` |
| 内容后台 | `apps/cms` | Next.js 全栈（Node 运行时） | `npm install && npm run build` | 按 Next.js 预设（`.next`） |

**操作步骤：**

1. 📤 先将本仓库推送至 GitHub / Gitee（当前仓库尚未配置远程地址：`git remote add origin <你的仓库地址> && git push -u origin main`）。
2. 🌐 腾讯云控制台打开 EdgeOne → Makers → **创建项目 → 导入 Git 仓库**，授权并选择上述仓库与分支。
3. 🏗️ **项目 1（站点）**：根目录填 `apps/blog`，构建命令 `npm run build`，输出目录 `dist`。环境变量需设置 `SITE_URL` 与 **`PUBLIC_PAYLOAD_URL`（指向项目 2 的线上域名，构建时用于拉取内容）**。
4. 💾 **项目 2（后台）**：根目录填 `apps/cms`，选择 Next.js / Node 运行时预设。环境变量配置 `DATABASE_DRIVER=postgres`、`POSTGRES_URL`（Neon 等托管库）、`PAYLOAD_SECRET`；首次建表时加 `PAYLOAD_FORCE_PUSH=1`。
5. 🎉 等待部署完成后，把项目 2 的域名填入项目 1 的 `PUBLIC_PAYLOAD_URL`，重新部署站点即可全量上线。

> [!WARNING]
> - **Serverless 无持久磁盘，CMS 的 SQLite 单文件只适合本地开发；线上必须用 `postgres` 托管库**（项目已内置 `@payloadcms/db-postgres`，并带 `projects` 集合的迁移）。
> - CMS 依赖 Node 运行时与 `sharp`，请在 Makers 中选择支持 Node/Next SSR 的方案（而非纯边缘函数）。
> - **运行时常量**：SSE 与内存缓存均为单实例级；EdgeOne 多实例时靠 5s TTL 快照 + 前台轮询兜底，最终一致。
> - `apps/blog/patches/astro+7.2.0.patch` 为本地开发用补丁（修复中文路径 301 跳转的 Location 头编码），静态托管无需生效。

---

## 🧰 后台脚本说明

| 📜 脚本 | ✨ 作用 |
| --- | --- |
| `apps/cms/src/scripts/import-markdown.ts` | 把历史 `apps/blog/src/content` 的 Markdown 导入后台（`npm run import:data`），用于一次性数据迁移，日常维护均在后台完成 |
| `apps/cms/scripts/copy-blog-to-public.mjs` | 构建站点后把博客产物复制到 CMS public 目录（`npm run build:all` 时执行） |
| `apps/cms/scripts/generate-preview-css.mjs` | 读取 `apps/blog/src/styles/global.css` 生成后台 Markdown 预览样式 |
| `apps/cms/scripts/warmup.mjs` | 部署后预热后台接口 |

---

## 📜 许可证

**MIT** ✅ — 详见根目录 [LICENSE](LICENSE)。

---

<div align="center">

Made with ❤️ · 记录 AI、代码、网站搭建和技术观察

</div>
