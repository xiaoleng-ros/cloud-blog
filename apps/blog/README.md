<div align="center">

# 🌠 cloud-blog · 博客前端（Blog）

**一个基于 Astro 的个人博客前端** — 内容全部来自后台 CMS，「写博客」从此只发生在后台。

![Astro](https://img.shields.io/badge/Astro-7.0-orange?logo=astro&logoColor=ff5d01)
![Node.js](https://img.shields.io/badge/Node-%3E=18.20-green?logo=nodedotjs&logoColor=white)

📌 这是 `cloud-blog` monorepo 的**站点前端应用**（独立依赖、独立部署）；后台位于仓库根 `../cms`，完整说明见根目录 `README.md`。

</div>

包含 ✍️ 文章 · 📝 随笔 · 📂 归档 · 🏷️ 分类 · 🏷️ 标签 · 🔍 搜索 · 📡 RSS · 🗺️ 站点地图 · 💬 Twikoo 评论 · 🧑🏫 关于页。

---

## ☁️ 内容从哪来？

> [!NOTE]
> 前台**不再维护本地 Markdown / JSON**，内容一律从后台（Payload CMS）拉取。

- 📰 **文章（Posts）/ 随笔（Notes）/ 项目（Projects）**：通过 Astro content loader（`src/lib/payload-loader.ts`）在构建 / 开发时从后台 REST API 载入，集合定义见 `src/content.config.ts`。
- 🏠 **站点信息（名称 / 描述 / 作者）与 Hero 文案**：优先读取后台 `SiteSettings` 全局，缺失时回退到 `src/lib/site-defaults.ts` 的默认值；🧭 导航菜单来自后台 `Navigation` 全局。
- 🧩 **关于页项目卡片**：全部来自后台 `projects` 集合，按 `group` 分组聚合展示。
- ⚡ **运行时热同步**：后台数据变更后，已打开的页面通过后台 `/api/blog-sync` 接口（SSE 主路径 + 轮询兜底）局部更新带 `data-sync-block` 锚点的区块。

> [!TIP]
> 后台未运行时，构建/开发仍可进行，只是文章/随笔/项目为空，页面仍可正常访问（站点默认值兜底）。

---

## 🗂️ 项目结构

```
blog/
├── 🌐 public/                # 静态资源（头像、封面兜底图等）
├── 📦 src/
│   ├── 🧩 components/        # 组件（导航、音乐播放器、评论、技能环等）
│   ├── 🖼️ layouts/           # 页面布局（BaseLayout 内含运行时同步脚本）
│   ├── 🛠️ lib/               # 后台取数（payload-api / payload-loader）、站点默认值、Markdown 插件
│   ├── 📄 pages/             # 路由页面（首页、归档、搜索、RSS、关于等）
│   ├── 🧬 content.config.ts  # posts / notes / projects 集合定义
│   └── 🎨 styles/            # 全局样式
├── 🩹 patches/               # astro 本地开发补丁（中文路径 Location 编码）
├── ⚙️ astro.config.mjs       # Astro 配置（含 payload-hot-reload）
├── 🔌 proxy.mjs              # 开发期代理（可选）
└── 📜 package.json
```

---

## 🚀 快速开始

> [!NOTE]
> 环境要求：**只需要 Node.js（>= 18.20）**。不需要单独安装 Astro — 它是项目依赖，`npm install` 时自动装好（npm 随 Node.js 一起安装）。

```bash
# 1. 安装依赖（自动安装 Astro）
npm install

# 2. 启动本地预览 → http://localhost:4321
npm run dev
```

在 monorepo 根目录可直接用 `npm run dev:blog`。建议同时启动后台（`npm run dev:cms`，默认 `http://localhost:9527`），否则内容为空 — 修改后台数据后前台会自动热同步。

---

## 🏗️ 构建

```bash
npm run build
npm run preview
```

构建产物输出到 `dist/`，可部署到任意静态托管平台。构建时前端会连后台拉取最新内容，因此部署前请确保 `PUBLIC_PAYLOAD_URL` 指向可访问的后台地址。

---

## 🌐 部署

1. 🔗 连接仓库（Vercel / Netlify / Cloudflare Pages / GitHub Pages 均可），构建命令 `npm run build`，输出目录 `dist`
2. 🎛️ 在平台环境变量中设置 `SITE_URL` 为正式域名，并设置 `PUBLIC_PAYLOAD_URL` 指向后台地址（构建时拉取内容用）
3. 🌍 自定义域名按平台指引添加 DNS 解析（CNAME 记录）
4. 🔄 若旧域名需要迁移，在平台侧配置 301 重定向

> [!TIP]
> 完整的前后台部署方案（EdgeOne Makers 两个独立项目）见根目录 `README.md`。

---

## 🗝️ 环境变量

复制 `.env.example` 为 `.env`，按需填写：

```bash
SITE_URL=https://example.com
PUBLIC_PAYLOAD_URL=https://your-domain.example.com
PUBLIC_TWIKOO_ENV_ID=https://your-twikoo.example.com
PUBLIC_NETEASE_PLAYLIST_ID=8792942606
PUBLIC_MUSIC_API=https://meting.mikus.ink/api
```

| 🎛️ 变量 | 💡 说明 |
| --- | --- |
| `SITE_URL` | 站点正式域名，用于 RSS、sitemap、canonical URL 和结构化数据 |
| `PUBLIC_PAYLOAD_URL` | 后台 API 地址，默认 `http://localhost:9527`，构建时用于拉取内容 |
| `PUBLIC_TWIKOO_ENV_ID` | Twikoo 后端地址。未配置时，评论区和选中文字引用评论功能自动隐藏 |
| `PUBLIC_NETEASE_PLAYLIST_ID` | 网易云音乐歌单 ID。未配置时使用默认歌单 `8792942606` |
| `PUBLIC_MUSIC_API` | Meting 兼容的音乐 API 地址，默认 `https://meting.mikus.ink/api`，也可换成自建服务 |

---

## 🎵 音乐播放器

全站右下角的悬浮播放器会在浏览器中**按需读取网易云歌单，不会自动播放**。替换歌单时，从网易云歌单链接中复制 `id` 数字，写入 `.env` 的 `PUBLIC_NETEASE_PLAYLIST_ID` 后重新启动开发服务。

> [!WARNING]
> Meting 是非官方接入方式，受网易云版权、VIP 与地区限制影响，个别歌曲可能无法播放。生产环境若需要更稳定，建议将 `PUBLIC_MUSIC_API` 指向自建的 Meting 兼容服务。

---

## 💬 评论

评论前端没有使用 Twikoo 的默认 UI，而是通过 `src/lib/comments.js` 调用 Twikoo 后端接口并渲染自定义样式。

文章正文支持选中文字后引用到底部评论区：

1. ✅ 确认 `.env` 已配置 `PUBLIC_TWIKOO_ENV_ID`，否则评论区和引用按钮都会隐藏。
2. ✍️ 在文章正文或随笔正文中拖选至少 2 个字符。
3. 💡 选区上方会出现「引用评论」按钮。
4. 📥 点击按钮后页面会滚动到底部评论区，并把选中的文字以 Markdown blockquote 写入评论框。
5. ↩️ 发送成功后页面会回到刚才的阅读位置。

---

## ❓ 常见问题

<details>
<summary>🖥️ <b>没装过 Node.js 怎么办？</b></summary>

到 https://nodejs.org/ 下载 LTS 版本安装，npm 会一并装好，然后回到「快速开始」从第 1 步继续。

</details>

<details>
<summary>🐢 <b>`npm install` 很慢 / 失败？</b></summary>

国内网络可切换到镜像源：

```bash
npm config set registry https://registry.npmmirror.com
```

</details>

<details>
<summary>⚠️ <b>提示 Node 版本太低？</b></summary>

项目要求 Node 18.20+ / 20.3+ / 22+，升级 Node.js 后重试。

</details>

<details>
<summary>🚪 <b>端口被占用？</b></summary>

`npm run dev -- --port 4322` 指定其他端口。

</details>

<details>
<summary>🏚️ <b>后台没启动，内容为空？</b></summary>

前台从后台取数，未启动后台时文章/随笔/项目为空属正常现象。启动后台（`npm run dev:cms`，默认 `http://localhost:9527`）后刷新即恢复。

</details>

---

## 📜 许可证

本项目基于 **MIT** ✅ License 开源（见 [LICENSE](LICENSE)）。

---

<div align="center">

Made with ❤️ · 记录 AI、代码、网站搭建和技术观察

</div>
