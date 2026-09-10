# cloud-blog（云岫的博客）· Monorepo

单仓库、双应用的 monorepo。两个应用相互独立、各自带 `package.json` 与 lockfile，可**在 EdgeOne Makers 中分别建成两个独立项目**部署。

| 目录 | 应用 | 技术栈 | 说明 |
| --- | --- | --- | --- |
| `apps/blog` | 博客前端 | Astro 7（静态站） | 文章 / 随笔 / 归档 / 搜索 / RSS，构建时从后台拉取内容 |
| `apps/cms` | 博客后台 | Payload CMS 3 + Next.js 15 | 文章 / 随笔 / 分类标签 / 站点设置管理 |

```
cloud/
├── apps/
│   ├── blog/                    # → EdgeOne Makers 项目 1（站点）
│   │   ├── astro.config.mjs
│   │   ├── src/                 # 页面 / 组件 / content 集合 / 样式
│   │   ├── public/
│   │   ├── patches/             # astro 本地开发补丁（中文路径 Location 编码）
│   │   ├── package.json         # 独立依赖与 package-lock.json
│   │   ├── .env.example         # 站点环境变量示例
│   │   └── README.md            # 博客使用说明
│   └── cms/                     # → EdgeOne Makers 项目 2（后台）
│       ├── src/payload.config.ts
│       ├── next.config.mjs
│       ├── scripts/             # generate-preview-css 等
│       ├── package.json         # 独立依赖与 package-lock.json
│       └── tsconfig.json
├── images/                      # 仓库级素材（暂未被应用引用）
├── package.json                 # 根编排脚本（私有，无第三方依赖）
├── .gitignore
└── LICENSE
```

## 本地开发

```bash
# 首次：分别安装两个应用的依赖
npm run setup

# 终端 1：博客前端 → http://localhost:4321
npm run dev:blog

# 终端 2：内容后台 → http://localhost:9527  （默认 SQLite，零配置）
npm run dev:cms
```

- 前端构建/开发时优先从后台 API（`PUBLIC_PAYLOAD_URL`，默认 `http://localhost:9527`）拉取内容；**后台不可用时自动回退到本地 `apps/blog/src/content` 的 Markdown**，前后台可各自独立开发。
- 开发期后台数据变更会热同步到前台页面。各应用详情见 `apps/blog/README.md`、`apps/cms/package.json`。

## 环境变量

`apps/blog/.env`（参考 `apps/blog/.env.example`）：

| 变量 | 用途 |
| --- | --- |
| `SITE_URL` | 站点正式域名（RSS / sitemap / canonical） |
| `PUBLIC_PAYLOAD_URL` | Payload 后台地址，默认 `http://localhost:9527` |
| `PUBLIC_TWIKOO_ENV_ID` | Twikoo 评论后端，不配则评论隐藏 |
| `PUBLIC_NETEASE_PLAYLIST_ID` / `PUBLIC_MUSIC_API` | 音乐播放器歌单 |

`apps/cms` 生产环境变量（本地 SQLite 无需配置）：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_DRIVER` | `sqlite`（默认）/ `postgres` |
| `POSTGRES_URL` | `postgres` 时的连接串（如 Neon） |
| `PAYLOAD_SECRET` | Payload 加密密钥（生产必填） |
| `PAYLOAD_FORCE_PUSH=1` | 首次向线上库非交互建表 |

## 部署到 EdgeOne Makers

本仓库可在 EdgeOne Makers（控制台 → EdgeOne → Makers）中创建 **两个相互独立的项目**，同一仓库、不同根目录：

| 项目 | 仓库根目录 | 类型 | 构建命令 | 输出目录 |
| --- | --- | --- | --- | --- |
| 博客站点 | `apps/blog` | 静态站（Astro） | `npm install && npm run build` | `dist` |
| 内容后台 | `apps/cms` | Next.js 全栈（Node 运行时） | `npm install && npm run build` | 按 Next.js 预设（`.next`） |

操作步骤：

1. 先将本仓库推送至 GitHub / Gitee（当前仓库尚未配置远程地址：`git remote add origin <你的仓库地址> && git push -u origin main`）。
2. 腾讯云控制台打开 EdgeOne → Makers → **创建项目 → 导入 Git 仓库**，授权并选择上述仓库与分支。
3. **项目 1（站点）**：根目录填 `apps/blog`，构建命令 `npm run build`，输出目录 `dist`。环境变量需配置 `SITE_URL` 与 **`PUBLIC_PAYLOAD_URL`（指向项目 2 的线上域名，构建时用于拉取内容）**。
4. **项目 2（后台）**：根目录填 `apps/cms`，选择 Next.js / Node 运行时预设。环境变量配置 `DATABASE_DRIVER=postgres`、`POSTGRES_URL`（Neon 等托管库）、`PAYLOAD_SECRET`；首次建表时加 `PAYLOAD_FORCE_PUSH=1`。
5. 等待部署完成后，把项目 2 的域名填入项目 1 的 `PUBLIC_PAYLOAD_URL`，重新部署站点即可全量上线。

> 注意：
> - **Serverless 无持久磁盘，CMS 的 SQLite 单文件只适合本地开发；线上必须用 `postgres` 托管库**（项目已内置 `@payloadcms/db-postgres`）。
> - CMS 依赖 Node 运行时与 `sharp`，请在 Makers 中选择支持 Node/Next SSR 的方案（而非纯边缘函数）。
> - `apps/blog/patches/astro+7.2.0.patch` 为本地开发用补丁（修复中文路径 301 跳转的 Location 头编码），静态托管无需生效。

## 迁移脚本说明

monorepo 化后，`apps/cms` 内两个引用前台样式的脚本已同步指向 `apps/blog`：

- `apps/cms/src/scripts/import-markdown.ts`：把 `apps/blog/src/content` 的 Markdown 导入后台（`npm run import:data`）。
- `apps/cms/scripts/generate-preview-css.mjs`：读取 `apps/blog/src/styles/global.css` 生成后台预览样式。

## 许可证

MIT，见根目录 [LICENSE](LICENSE)。
