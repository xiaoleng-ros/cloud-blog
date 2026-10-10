<div align="center">

# ☁️ cloud-blog · 云岫的博客

**一个「前台 + 后台」双应用的 Monorepo** — 用 Astro 🌠 做站点，用 Payload CMS 💼 管内容。

![Astro](https://img.shields.io/badge/Astro-7.2-orange?logo=astro&logoColor=ff5d01)
![Payload](https://img.shields.io/badge/Payload-3.88-gray?logo=payload&logoColor=ffffff)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-blue?logo=gnu&logoColor=white)

**✨ 一条命令搞定发布 ✨**

</div>

---

## 🌱 项目来源与致谢

> [!IMPORTANT]
> 本项目不是从零开始写的，它站在两个开源项目之上。**代码与素材的来龙去脉如下，请一并遵守其许可。**

| 🙏 项目 | 关系 | 许可 |
| --- | --- | --- |
| [**clay-blog**](https://github.com/laogou717/clay-blog)（神烦老狗） | **前台基底**：`apps/blog` 的 Astro 骨架、组件与样式源自它，本项目在其上大幅重构（内容全部改由 Payload 提供、加实时同步、重做页面与版式） | MIT ✅ |
| [**ThriveX-Blog**](https://github.com/LiuYuYang01/ThriveX-Blog)（LiuYuYang01） | **版式与交互参考**：后台卡片式外壳、两级缩进导航、标签页记忆、数据概览页与部分前台布局，均参考其设计后自行实现（**未复制其源代码**）；外加**一张静态素材**——页脚动物插画 `apps/blog/public/images/footer-animals.png` 与其 `Footer/images/animals.webp` 为同一文件 | GPL-3.0 ⚠️ |

- `apps/cms`（Payload CMS 后台）为本项目自行编写，基于 Payload 官方脚手架模板。
- 因为包含了 ThriveX 的 GPL-3.0 素材（页脚插画），**本仓库整体按 GPL-3.0 发布**，而不是前台基底原本的 MIT。
- 完整的第三方来源、署名与许可全文见 **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**。

---

## 🧬 仓库速览

两个应用相互独立、各自带 `package.json` 与 lockfile；**部署时作为同一个 EdgeOne Makers 项目**（根目录 `apps/cms`）一起上线，前后台同域名：

| 📦 目录 | 🚀 应用 | 🧰 技术栈 | 💡 说明 |
| --- | --- | --- | --- |
| `apps/blog` | 博客前端 | 🌠 Astro 7（静态站） | 文章 / 随笔 / 归档 / 搜索 / RSS / 关于页，构建时从后台拉取内容 |
| `apps/cms` | 内容后台 | 💼 Payload CMS 3.88 + Next.js 16 | 文章 / 随笔 / 项目 / 分类标签 / 站点设置 / 导航管理，是内容的**唯一数据源** |

```
cloud/
├── 📦 apps/
│   ├── 🌠 blog/                    # 博客前端（源自 clay-blog）
│   │   ├── astro.config.mjs                    # Astro 配置（含 payload-hot-reload）
│   │   ├── src/                                # 页面 / 组件 / content collections / 样式
│   │   │   ├── content.config.ts               # posts / notes / projects 集合定义
│   │   │   └── lib/
│   │   │       ├── payload-api.ts              # 后台 REST 客户端（文章/随笔/项目/设置/导航）
│   │   │       ├── payload-loader.ts           # Astro loader：从后台载入并轮询变化
│   │   │       ├── site-defaults.ts            # 站点默认值（后台缺失时兜底）
│   │   │       ├── site-settings.ts            # 从后台读取站点设置
│   │   │       └── posts.ts                    # 站点信息与文章排序等工具
│   │   ├── public/                             # 静态资源（含页脚插画：来自 ThriveX，见来源说明）
│   │   ├── patches/                            # astro 本地开发补丁（中文路径编码）
│   │   ├── package.json                        # 独立依赖 + lockfile
│   │   ├── .env.example                        # 站点环境变量示例
│   │   └── README.md                           # 博客使用说明
│   └── 💼 cms/                     # → EdgeOne Makers 项目（后台 + 托管前台产物）
│       ├── src/payload.config.ts               # Payload 主配置
│       ├── src/collections/                    # Posts / Notes / Projects / Categories / Tags / Media / Users
│       ├── src/globals/                        # SiteSettings / Navigation
│       ├── src/lib/                            # blog-render（区块渲染）/ blog-sync（数据同步）/ sync-cache
│       ├── src/app/api/                        # blog-sync（版本探测+全量区块）/ blog-sync/stream（SSE）
│       ├── src/app/[[...path]]/route.ts        # catch-all：返回静态外壳并注入最新数据
│       ├── src/migrations/                     # Postgres 迁移（含 projects 集合）
│       ├── next.config.mjs
│       ├── scripts/                            # copy-blog-to-public / sync-blog-shells / pg 启停 / warmup 等
│       ├── package.json                        # 独立依赖 + lockfile
│       └── tsconfig.json
├── 📦 shared/                       # 跨应用共享模块（html-safety / post-utils / remark-rehype 插件等）
├── 📄 package.json                # 根编排脚本（私有，无第三方依赖），exports 暴露 ./shared/*
├── 📌 .gitignore
├── 📜 LICENSE                      # GPL-3.0 全文
└── 🙏 THIRD-PARTY-NOTICES.md       # 第三方来源与署名（clay-blog / ThriveX）
```

> `shared/` 的接线方式：两个应用都在各自 `package.json` 里声明依赖 `"cloud-blog": "file:../.."`
> （指回根包），再通过根包 `exports` 的 `./shared/*` 子路径导入，如 `import { ... } from 'cloud-blog/shared/html-safety'`。

---

## 🏗️ 内容架构

> [!IMPORTANT]
> 写博客的**所有内容都放进后台**，前台**不再维护本地 Markdown / JSON 数据**。

- 🗄️ **数据源**：`apps/cms` 的 Payload 集合是唯一事实来源 — 文章（Posts）、随笔（Notes）、项目（Projects）、分类（Categories）、标签（Tags），外加两个全局：站点设置（SiteSettings）与导航（Navigation）。
- 📡 **前台取数**：`apps/blog` 通过 Astro content loader（`payload-loader.ts`）在构建 / 开发时从后台 REST API 拉取 posts / notes / projects；站点名称、描述、作者在后台缺失时回退到 `lib/site-defaults.ts` 的默认值。
- 🧩 **关于页项目**：开源项目与资源下载卡片全部来自后台 `projects` 集合（按 `group` 分组聚合），不再依赖 GitHub API 构建时抓取或本地缓存 JSON。
- 🔥 **首屏就是最新数据**：`apps/cms` 的 catch-all 路由（`src/app/[[...path]]/route.ts`）在返回 HTML 前，会用 `blog-render` 按后台最新数据渲染区块并**直接注入静态外壳**，所以打开页面不会先闪一下构建时的旧内容。博客 HTML 单独放在 `apps/cms/public/__blog/`（不能摊在 `public/` 根下，否则会被静态托管直接命中、绕过注入）。
- 🔁 **页面打开后继续同步**：后台数据变更后，已打开的页面通过轮询（`/api/blog-sync?version=1` 版本探测 + 全量区块，SSE `/api/blog-sync/stream` 亦可）局部替换带 `data-sync-block` 锚点的区块；站点图标、歌单等**运行时值**随同一次响应下发，由前台脚本直接应用。服务端已注入过的区块带 `data-sync-version`，版本一致时客户端不会重复改写 DOM。
- 🧱 **外壳缺失有模板兜底**：新增文章在静态产物里还没有对应 HTML 时，按「同形模板外壳」即时渲染，不会 404。

> [!IMPORTANT]
> 区块约定：`blog-render` 里每个渲染函数返回的是**锚点元素的 innerHTML**（不含外层容器），
> 与 `*.astro` 模板中 `<xxx data-sync-block="id">` 一一对应。若返回里再带一层同名容器，
> 每次同步都会多套一层（双层边框/内边距）。

```mermaid
flowchart LR
  B[💼 Payload CMS 后台] -->|响应时注入区块| D[🌐 浏览器页面]
  B -->|loader 构建时取数| A[🌠 Astro 前端]
  A -->|静态外壳 public/__blog| C[cms catch-all 路由]
  C -->|注入最新数据| D
  B -->|轮询 / SSE 增量更新| D
```

---

## 🚀 本地开发

> [!TIP]
> 前端会优先从后台取数；**同时启动两个应用**才能看到完整内容。

```bash
# 🛠️ 首次：分别安装两个应用的依赖
npm run setup

# 🖥️ 终端 1：博客前端 → http://localhost:3000
npm run dev:blog

# 🗄️ 终端 2：内容后台 → http://localhost:9527
npm run dev:cms:warm     # 推荐：按需启动本地 PG → 拉起 Next → 预热常用接口
# 也可用 npm run dev:local --prefix apps/cms（起 PG + 后台，不做预热）
```

- 📡 前端构建/开发时从后台 API（`PUBLIC_PAYLOAD_URL`，默认 `http://localhost:9527`）拉取内容；**后台未运行时文章/随笔/项目为空**，但页面仍可正常访问（站点默认值兜底）。
- ⚡ 开发期后台数据变更会热同步到前台页面（`payload-hot-reload`：loader 检测变化后 touch 标记文件并广播整页刷新；生产走 SSE + 轮询）。
- 🔀 需要**同源 `/api/*`**（验证评论、SSE 等依赖同源的行为）时，用 `npm run dev:proxy`：它会在 `4321` 起一个代理并把 Astro 一并拉起；纯 UI 调试跑 `dev:blog` 单进程即可。
- 🐘 本地 Postgres 使用 `D:\pglocal` 绿色版（端口 5433，库 `blog_dev`），由 `apps/cms` 的 `pg:start` / `pg:stop` / `pg:status` 按需启停，**零常驻**。

---

## 🗝️ 环境变量

`apps/blog/.env`（参考 `apps/blog/.env.example`）：

| 🎛️ 变量 | 💡 用途 |
| --- | --- |
| `SITE_URL` | 站点正式域名（RSS / sitemap / canonical），构建时写入静态产物 |
| `PUBLIC_PAYLOAD_URL` | Payload 后台地址，本地默认 `http://localhost:9527`；线上填**真实域名**（不带 `/api`） |
| `PUBLIC_WALINE_URL` | 💬 Waline 评论服务地址；留空默认同域 `/api/waline`（前后台同域部署无需配置） |
| `PUBLIC_NETEASE_PLAYLIST_ID` / `PUBLIC_MUSIC_API` | 🎵 音乐播放器歌单 |

> 前台取数地址的优先级：`PUBLIC_PAYLOAD_URL` → `SITE_URL`（一体化部署前后台同域）→ `http://localhost:9527`。

`apps/cms` 环境变量（复制 `apps/cms/.env.example` 为 `.env`；本地开发同样默认 postgres，指向 `D:\pglocal` 绿色版 PG）：

| 🎛️ 变量 | 💡 用途 |
| --- | --- |
| `DATABASE_DRIVER` | `postgres`（默认，本地与生产一致）/ `sqlite`（保留的历史分支，迁移是 Postgres 方言，不推荐） |
| `POSTGRES_URL` | 连接串：本地 `postgresql://postgres@127.0.0.1:5433/blog_dev`；生产填托管库（如 Supabase / Neon） |
| `PAYLOAD_SECRET` | Payload 加密密钥（生产必填） |
| `PAYLOAD_FORCE_PUSH=1` | 首次向线上库非交互建表 |

---

## 🚢 部署到 EdgeOne Makers（一体化：前台 + 后台同一个项目）

前后台部署在**同一个 EdgeOne Makers 项目**里，同域名：`/` 是博客，`/admin`、`/api` 是 Payload 后台。

| 🧭 配置项 | 🔧 值 |
| --- | --- |
| 仓库根目录 | `apps/cms` |
| 框架预设 | `Next.js`（必须是这个，否则 catch-all 路由与 SSR 不生效） |
| 构建命令 | 见 `apps/cms/edgeone.json`（装 blog 依赖 → `astro build` → `next build` → 复制产物到 `public/`） |
| 输出目录 | `.next` |
| Node 版本 | 22.21.1 |

**环境变量要配在 cms 项目上：**

| 🎛️ 变量 | 💡 用途 |
| --- | --- |
| `DATABASE_DRIVER` | `postgres` |
| `POSTGRES_URL` | Supabase / Neon 连接串 |
| `PAYLOAD_SECRET` | Payload 加密密钥 |
| `NEXT_PUBLIC_SERVER_URL` | 站点正式域名（如 `https://blog.iceuu.icu`） |
| `SITE_URL` | 同上（Astro 构建用：canonical / RSS / sitemap） |
| `PUBLIC_PAYLOAD_URL` | **只要域名**（如 `https://blog.iceuu.icu`），不要带 `/api` |
| `PAYLOAD_FORCE_PUSH=1` | 仅首次建表用，建完请删掉 |

> [!WARNING]
> - `PUBLIC_PAYLOAD_URL` / `SITE_URL` 必须是**真实线上域名**。若留占位域名，Astro 构建时拉不到后台数据，
>   会退化成「模板默认文案 + 0 篇文章」，并且**不会生成任何文章详情页**（`/posts/*` 全部 404）。
>   构建日志里会打印明确的 `[payload-loader] ⚠️` 提示。
> - 首次部署（站点还没上线时）构建必然拉不到数据，属正常；上线后在控制台填好域名重新部署一次即可。
> - **Serverless 无持久磁盘，线上必须用 `postgres` 托管库**（项目已内置 `@payloadcms/db-postgres`，并带 `projects` 集合的迁移）。SQLite 分支仅作保留：`migrations/` 是 Postgres 方言，用它无法复用线上迁移，不推荐。
> - CMS 依赖 Node 运行时与 `sharp`，请在 Makers 中选择支持 Node/Next SSR 的方案（而非纯边缘函数）。
> - **运行时常量**：SSE 与内存缓存均为单实例级；EdgeOne 多实例时靠 5s TTL 快照 + 前台轮询兜底，最终一致。
> - 代码更新后需**重新部署**才会生效；若仓库有新迁移，请在部署时执行（`payload migrate`）。

---

## 🧰 脚本说明

| 📜 脚本 | ✨ 作用 |
| --- | --- |
| `npm run dev:cms:warm` | 本地一键：起 PG → 起后台 → 预热常用接口（含评论路由，避免首次点击卡编译） |
| `npm run build:all` | 构建前台 + 后台，并把博客产物复制进 CMS 的 `public/` |
| `npm run sync:blog` | 把最新博客外壳同步到 CMS（`apps/cms/scripts/sync-blog-shells.mjs`） |
| `apps/cms/scripts/copy-blog-to-public.mjs` | 构建站点后把博客产物复制到 CMS public 目录（`build:all` 时执行） |
| `apps/cms/scripts/generate-preview-css.mjs` | 读取 `apps/blog/src/styles/global.css` 生成后台 Markdown 预览样式 |
| `apps/cms/scripts/warmup.mjs` | 部署后 / 开发期预热后台接口 |
| `apps/cms/scripts/pg.mjs` | 本地绿色版 Postgres 的 `start` / `stop` / `status` |
| `apps/cms/src/scripts/import-markdown.ts` | 把历史 `apps/blog/src/content` 的 Markdown 导入后台（`npm run import:data`），用于一次性数据迁移，日常维护均在后台完成 |
| `npm run typecheck` | 两个应用的类型检查（`astro check` + `tsc --noEmit`） |

---

## 📜 许可证

**GPL-3.0** ⚖️ — 详见根目录 [LICENSE](LICENSE)。

为什么不是 MIT：

- 前台基底 **clay-blog 是 MIT**（宽松，可与 GPL 共存）；
- 但项目里包含一件来自 **ThriveX-Blog（GPL-3.0）** 的静态素材（页脚动物插画），
  GPL-3.0 具有传染性，**只要分发其中一部分，整体就必须以 GPL-3.0 发布**；
- 因此本仓库整体采用 **GPL-3.0**：你可以自由使用、修改、分发，但**衍生作品也必须以 GPL-3.0 开源**，并保留原作者署名。

第三方来源与署名全文见 **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**。

---

<div align="center">

🙏 感谢 [clay-blog](https://github.com/laogou717/clay-blog) 与 [ThriveX-Blog](https://github.com/LiuYuYang01/ThriveX-Blog) 的开源工作

Made with ❤️ · 记录 AI、代码、网站搭建和技术观察

</div>
