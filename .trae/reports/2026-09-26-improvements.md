# cloud Monorepo 问题报告与解决方案

> 生成日期：2026-09-26
> 项目结构：`apps/blog`（Astro 静态博客）+ `apps/cms`（Payload CMS 后台）+ `shared/`（复用工具）
> 核心架构：Astro 生成静态 HTML 外壳 → CMS 通过 `html-inject.ts` 把动态区块注入首屏 → SSE + 30s 轮询做增量刷新

***

## 目录

- [关键结论](#关键结论)

- [高优先级 P0](#高优先级-p0--影响安全正确性建议本周修完)

- [中优先级 P1](#中优先级-p1--影响性能可维护性)

- [低优先级 P2](#低优先级-p2--顺手改)

- [长期架构建议](#长期架构建议)

- [推荐执行顺序](#推荐执行顺序)

- [附录：改造验证用例](#附录改造验证用例)

***

## 关键结论

架构层面（Astro 外壳 + Payload CMS 注入 + SSE/轮询同步）**功能是自洽的**，但存在 4 个真正的红线问题：

1. `PAYLOAD_SECRET` 硬编码 fallback
2. Postgres TLS 校验被关闭
3. Markdown 渲染开启 `allowDangerousHtml: true`
4. `html-inject.ts` 用手写正则做 HTML 解析

此外，整个 monorepo **没有 lint / test / typecheck 脚本**，是所有单点问题背后最大的隐性风险。

***

## 高优先级（P0）— 影响安全/正确性，建议本周修完

### P0-1 · PAYLOAD\_SECRET 硬编码 fallback

**文件**：`apps/cms/src/payload.config.ts`（L103-L109）

**问题描述**

```ts
const PAYLOAD_SECRET_FALLBACK = 'clay-blog-dev-secret-key-2026-random-string-change-in-production'
const payloadSecret = process.env.PAYLOAD_SECRET || PAYLOAD_SECRET_FALLBACK
```

生产漏配环境变量时会静默使用代码库里公开可查的默认密钥。

**影响**

Payload 用 `secret` 做 HMAC 签 cookie；拿到这个字符串的任何人可以伪造 admin cookie 直接绕过登录。

**解决方案**

```ts
// apps/cms/src/payload.config.ts
const secret = process.env.PAYLOAD_SECRET
if (!secret) {
  throw new Error('PAYLOAD_SECRET 未配置：请在 EdgeOne 控制台或本地 .env 中设置（长度 >= 32）')
}
if (secret.length < 32 || secret.includes('change-in-production')) {
  throw new Error(`PAYLOAD_SECRET 无效：长度必须 >= 32 且不能是默认占位值`)
}
// 后续 secret: secret
```

配套：

1. 在 `apps/cms/.env.example` 里写明"必须覆盖默认值"
2. 在 `edgeone.json` 的 `buildCommand` 前置校验：`test -n "$PAYLOAD_SECRET" && ! echo "$PAYLOAD_SECRET" | grep -q "change-in-production"`
3. 原注释里那句"避免 EdgeOne 云端启动失败"是伪权衡——启动失败比被攻破好排查得多

***

### P0-2 · Postgres TLS 校验被关闭

**文件**：`apps/cms/src/payload.config.ts`（L132）

**问题描述**

```ts
ssl: { rejectUnauthorized: false }
```

注释说是"EdgeOne 网络 quirk"。

**影响**

Supabase Postgres 流量走明文。攻击者只要能劫持到某个中间节点（含被入侵的边缘 POP），就能嗅探 `SUPABASE_SERVICE_ROLE_KEY` 路径下的所有 SQL。

**解决方案**

```ts
import { readFileSync } from 'node:fs'

// 生产：显式加载 CA；非生产才允许跳过校验
const sslRootCert = process.env.PG_SSL_ROOT_CERT
  ? readFileSync(process.env.PG_SSL_ROOT_CERT, 'utf8')
  : undefined

db: {
  client: 'postgres',
  pool: {
    connectionString: process.env.DATABASE_URI!,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV !== 'production',
      ...(sslRootCert ? { ca: sslRootCert } : {}),
    },
  },
}
```

***

### P0-3 · Markdown 渲染开启 `allowDangerousHtml`

**文件**：`apps/cms/src/lib/blog-render.tsx`（L372、L376）

**问题描述**

```ts
.unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  ...
  .use(rehypeStringify, { allowDangerousHtml: true })
```

Markdown 编辑器本身 `sanitize: false`（信任作者），CMS 侧也不做二次清洗。

**影响**

链路是 `Markdown → HTML(保留原始) → JSON → JS insertAdjacentHTML 到浏览器`。作者贴错一个 `<script>` 或 `<img onerror=...>` 就直接被浏览器执行。

**解决方案**

**Step 1：把 markdown 管线抽到 shared**

```ts
// shared/markdown-pipeline.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkLegacyShortcodes from './remark-legacy-shortcodes.mjs'
import rehypeLegacyShortcodes from './rehype-legacy-shortcodes.mjs'
import rehypeImgAttrs from './rehype-img-attrs.mjs'

export function createMarkdownProcessor(opts: {
  allowRawHtml?: boolean
  collectHeadings?: (t: any) => void
}) {
  const chain = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLegacyShortcodes)
    .use(remarkRehype, { allowDangerousHtml: !!opts.allowRawHtml })
    .use(rehypeLegacyShortcodes)
    .use(rehypeImgAttrs)
  if (!opts.allowRawHtml) {
    chain.use(rehypeSanitize, defaultSchema)
  }
  if (opts.collectHeadings) chain.use(() => opts.collectHeadings)
  chain.use(rehypeStringify, { allowDangerousHtml: !!opts.allowRawHtml })
  return chain
}
```

**Step 2**：CMS 侧调用时 `allowRawHtml: false`（默认），Astro 构建时按需要开。

***

### P0-4 · `html-inject.ts` 用手写正则做 HTML 解析

**文件**：`apps/cms/src/lib/html-inject.ts`（L34-L101）

**问题描述**

`findTagEnd` + `findMatchingClose` 靠正则找同名闭合标签。注释里也承认"字符串解析脆弱"。

**影响**

- 首屏注入是 SEO 权重最大、CDN 缓存最容易被污染的路径

- 一旦文章正文里出现 `<article><article>...</article></article>` 或属性内含 `>` 字符，就会切错位置，页面结构错位

**解决方案**：换成 `parse5`（纯 AST，无 DOM 抽象，Next 里已可用）

```ts
import { parseFragment, serialize } from 'parse5'

export function injectSyncBlocks(
  html: string,
  blocks: Record<string, string>,
  version: string,
  title?: string | null,
): { html: string; injected: string[]; skipped: string[] } {
  const fragment = parseFragment(html)
  const injected: string[] = []
  const skipped: string[] = []

  const walk = (node: any) => {
    const id = node.attrs?.find((a: any) => a.name === 'data-sync-block')?.value
    if (id && id in blocks) {
      const fresh = blocks[id]!
      if (fresh) {
        node.childNodes = parseFragment(`<template>${fresh}</template>`).childNodes
        node.attrs = (node.attrs ?? []).map((a: any) =>
          a.name === 'data-sync-version' ? { ...a, value: version } : a,
        )
        injected.push(id)
      } else {
        skipped.push(id)
      }
    }
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(fragment)

  let out = serialize(fragment)
  if (title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeText(title)}</title>`)
  }
  return { html: out, injected, skipped }
}
```

***

## 中优先级（P1）— 影响性能/可维护性

### P1-1 · 全站 HTML 强制 `no-store`

**文件**：`apps/cms/src/app/[[...path]]/route.ts`

**问题描述**

```ts
res.headers.set('Cache-Control', 'no-store')
```

挂在所有 HTML 响应上，CDN 完全无法缓存。

**影响**

首页、归档页、关于页这类"改动频率极低"的页面白丢 90%+ 加速。

**解决方案**：分档策略

```ts
const HTML_CACHE: Record<string, string> = {
  '/': 'public, s-maxage=60, stale-while-revalidate=3600',
  '/archive': 'public, s-maxage=300, stale-while-revalidate=3600',
  '/about': 'public, s-maxage=300, stale-while-revalidate=3600',
  '/categories/': 'public, s-maxage=300, stale-while-revalidate=3600',
  '/tags/': 'public, s-maxage=300, stale-while-revalidate=3600',
}
res.headers.set('Cache-Control', HTML_CACHE[pathname] ?? 'private, no-store')
```

***

### P1-2 · 单文件巨型组件

**文件**：`apps/blog/src/components/MusicPlayer.astro`（2400+ 行）、`apps/blog/src/layouts/BaseLayout.astro`（866 行）

**问题描述**

- MusicPlayer：CSS + 网易云 API + 队列状态机 + localStorage + MediaSession 全塞一个 `.astro` 文件

- BaseLayout：主题切换、lightbox、TOC scrollspy、SSE 同步、代码块复制、返回顶部、快捷键共 7 个功能模块塞一个 `<script>`

**影响**

无法单元测试、热更新慢、PR review 无法聚焦。

**解决方案**

MusicPlayer 拆分：

```
src/components/music/
  MusicPlayer.astro        ← 只做 <slot> + <style>，200 行以内
  styles/main.css
  lib/api.ts               ← fetchSongList, fetchSongUrl, upgradeUrl
  lib/persistence.ts       ← localStorage + 版本号
  lib/queue.ts             ← 队列状态机
  lib/mediaSession.ts      ← MediaSession 封装
  components/PlayerPanel.astro
  components/QueueList.astro
```

BaseLayout 脚本拆分：

```
src/scripts/
  sync.ts    ← SSE + 轮询 + data-sync-block 注入
  ui.ts      ← lightbox、to-top、reveal
  nav.ts     ← ClientRouter 高亮、TOC scrollspy
  theme.ts   ← 主题 + view-transition
  code.ts    ← 代码块复制
```

BaseLayout 里只 `<script src="/scripts/xxx.js">`。

***

### P1-3 · SiteSettings 用 textarea + 分隔符存储结构化数据

**文件**：`apps/cms/src/globals/SiteSettings.ts`、`apps/blog/src/lib/site-settings.ts`

**问题描述**

`skills`、`socials`、`navItems`、`footerGroups`、`aboutParagraphs` 全部用 textarea，用空格/竖线/换行分隔再反解。

**影响**

1. `"https://x.com/foo bar"` 会被错切成两个 social
2. 用户写 `"Python Python 3"` 会得到 `href: ''`
3. CMS 和 blog 两侧各实现一份解析器，规则变更要双改
4. 图标 fallback 到空白时静默失败

**解决方案**：改成 Payload `array` 类型

```ts
{
  name: 'socials',
  type: 'array',
  label: '社交链接',
  fields: [
    {
      name: 'platform',
      type: 'select',
      required: true,
      options: [
        { label: 'Bilibili', value: 'bilibili' },
        { label: '抖音', value: 'douyin' },
        { label: 'YouTube', value: 'youtube' },
        { label: 'X', value: 'x' },
        { label: 'RSS', value: 'rss' },
      ],
    },
    {
      name: 'href',
      type: 'text',
      required: true,
      validate: (v) => /^https?:\/\//.test(v) || v.startsWith('/') ? true : 'URL 必须以 http(s):// 或 / 开头',
    },
  ],
}
```

配套写一次性迁移脚本 `apps/cms/scripts/migrate-settings-to-arrays.ts`。

***

### P1-4 · robots.txt 太薄

**文件**：`apps/blog/src/pages/robots.txt.ts`

**问题描述**

只有 `User-agent: *` + `Allow: /`，未 Disallow 后台路径。

**影响**

Google 会爬 `/admin/` 登录页 HTML（虽然被 401，但页面仍可能被收录，SEO 噪音）。

**解决方案**

```ts
return new Response([
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin/',
  'Disallow: /_next/',
  'Disallow: /api/',
  'Disallow: /__blog/',
  `Sitemap: ${siteUrl}/sitemap.xml`,
].join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
```

***

### P1-5 · RSS 元信息不完整

**文件**：`apps/blog/src/pages/rss.xml.ts`

**问题描述**

缺 `<generator>`、`<ttl>`、`<managingEditor>`；每条 `<item>` 缺 `<author>`。

**影响**

Feedly/NetNewsWire 认不到作者会退回到 feed 域名，每次拉取都拿全文（浪费带宽）。

**解决方案**

```xml
<channel>
  <generator>Astro</generator>
  <ttl>60</ttl>
  <managingEditor>{email}</managingEditor>
  <webMaster>{email}</webMaster>
  <lastBuildDate>{new Date().toUTCString()}</lastBuildDate>
</channel>
```

每条 item 加 `<author>{author} ({email})</author>`。

***

### P1-6 · Open Graph 缺 article 类型和时间戳

**文件**：`apps/blog/src/pages/posts/[...slug].astro`、`BaseLayout.astro`

**问题描述**

BaseLayout 里只有 `og:type=website`，文章页没有 `article:published_time`。

**影响**

分享到微信/微博/X 时不带"发布时间"标签，X 不显示大图（`twitter:card` 缺失）。

**解决方案**

```html
<meta property="og:type" content="article" />
<meta property="article:published_time" content={post.data.date.toISOString()} />
<meta property="article:modified_time" content={post.data.updated?.toISOString() ?? post.data.date.toISOString()} />
<meta property="article:section" content={category} />
{tags.map(t => <meta property="article:tag" content={t} />)}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@{twitterHandle}">
```

***

### P1-7 · shiki highlight 用正则替换会误伤代码块

**文件**：`apps/cms/src/lib/blog-render.tsx`（L300-L325）

**问题描述**

```ts
const pattern = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g
```

**影响**

如果正文里展示"如何写一段 `<pre>` 的 HTML"，正则会在错误位置切开。

**解决方案**：改用 `rehype-shiki` 在 AST 层做高亮

```ts
import rehypeShiki from 'rehype-shiki'

.unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeShiki, { theme: 'github-dark', langs: SHIKI_LANGS })
  .use(rehypeStringify)
```

***

### P1-8 · `middleware.ts` 只判 cookie 存在

**文件**：`apps/cms/src/middleware.ts`

**问题描述**

```ts
if (!cookies.has('payload-token')) return redirect('/admin/login')
```

**影响**

攻击者塞一个假 cookie 也能通过 Edge 中间件，进入 Payload 路由层再被打回，日志噪音大。

**解决方案**

```ts
const token = cookies.get('payload-token')?.value
const isJwt = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/.test(token ?? '')
if (!isJwt) return NextResponse.redirect(new URL('/admin/login', req.url))
```

***

### P1-9 · `apps/cms/edgeone.json` buildCommand 复杂

**文件**：`apps/cms/edgeone.json`

**问题描述**

```
rm -rf .next/cache && npm --prefix ../blog install && npm --prefix ../blog run build && npm run build && node scripts/copy-blog-to-public.mjs && rm -rf .next/cache
```

在 CMS 构建阶段重新装 blog 依赖，每次 CI 都跑，缓存命中率低。

**解决方案**：拆到 `prebuild`

```json
// apps/cms/package.json
{
  "scripts": {
    "prebuild": "npm --prefix ../blog run build && node scripts/copy-blog-to-public.mjs",
    "build": "next build"
  }
}
```

`edgeone.json` 只保留 `npm run build`。

***

## 低优先级（P2）— 顺手改

### P2-1 · 缺 `lint` / `test` / `typecheck` 脚本

**文件**：根 `package.json`、两个 app 的 `package.json`

**问题描述**

整个 monorepo 没有一个质量门。

**解决方案**

```json
// 根 package.json
{
  "scripts": {
    "typecheck": "npm run typecheck --prefix apps/cms && npm run typecheck --prefix apps/blog",
    "check": "npm run typecheck && npm run lint"
  }
}

// apps/cms/package.json
{
  "scripts": { "typecheck": "tsc --noEmit" }
}

// apps/blog/package.json
{
  "scripts": { "check": "astro check", "lint": "eslint ." }
}
```

为核心纯函数（`shared/post-utils.ts`、`html-inject.ts`、sanitize 白名单）加 vitest 单测。

***

### P2-2 · sitemap.xml 缺 priority/changefreq

**文件**：`apps/blog/src/pages/sitemap.xml.ts`

**解决方案**

```xml
<url>
  <loc>/</loc>
  <changefreq>daily</changefreq>
  <priority>1.0</priority>
</url>
```

对新站收录速度有边际影响。

***

### P2-3 · `payload.config.ts` 静态 import 双 DB adapter

**文件**：`apps/cms/src/payload.config.ts`

**问题描述**

同时 import `@payloadcms/db-postgres` 和 `@payloadcms/db-sqlite`，无论跑哪种环境都打包两份驱动。

**解决方案**：条件动态 import

```ts
let dbAdapter
if (process.env.PG_URI) {
  dbAdapter = (await import('@payloadcms/db-postgres')).default
} else {
  dbAdapter = (await import('@payloadcms/db-sqlite')).default
}
```

需要 `payload.config.ts` 改为 ESM 顶层 await。

***

### P2-4 · `site-settings.ts` 60s 缓存无失效机制

**文件**：`apps/blog/src/lib/site-settings.ts`

**问题描述**

`setTimeout` 触发一次后就没了；长时间运行 dev server 会持续过期判断。

**解决方案**

```ts
function getCachedSettings() {
  if (!cachedSettings) return null
  if (Date.now() - cachedAt >= SETTINGS_CACHE_TTL) {
    cachedSettings = null
    return null
  }
  return cachedSettings
}
```

***

### P2-5 · 缺根级 `.env.example`

**问题描述**

两个 app 各有一份，但没说清 monorepo 场景下 `NODE_ENV`、`PAYLOAD_URL`、`SITE_URL` 等共享变量的归属。

**解决方案**：新建 `.env.example.monorepo` 或在 `README` 里加一节"环境变量清单"，标注每个变量属于 blog / cms / 共享。

***

### P2-6 · 短代码插件双重处理

**文件**：`shared/remark-legacy-shortcodes.mjs`、`shared/rehype-legacy-shortcodes.mjs`

**问题描述**

两个插件都在处理 `{% xxx %}`，同一短代码可能被处理两次。

**解决方案**：remark 层处理完后给 node 打 `data.sync = true` 标记，rehype 层跳过带标记的节点。

***

### P2-7 · `apps/blog/src/lib/comments.js` 后缀不匹配

**问题描述**

项目在 `"type": "module"`，`.js` 文件用 `import` 语法，某些 bundler 会走 CJS 路径。

**解决方案**：改为 `.mjs` 或直接 `.ts`。

***

### P2-8 · MusicPlayer 只依赖单一网易云 API 域名

**文件**：`apps/blog/src/components/MusicPlayer.astro`

**问题描述**

`meting.mikus.ink` 挂掉 = 全站音乐播放器挂掉。

**解决方案**

```ts
const METING_API = [
  'https://meting.mikus.ink',
  'https://api.i-meto.com/meting/api',  // 备用
]
```

加 failover + 用户可切换源。

***

### P2-9 · `PostComposeView.tsx` 与 `NoteComposeView.tsx` 结构重复

**文件**：`apps/cms/src/admin/views/write/`

**解决方案**：抽出共享 hook

```ts
// apps/cms/src/admin/views/write/useCompose.ts
export function useCompose({ collection, storageKey }) {
  // 统一的自动保存、slug 生成、发布/取消发布逻辑
}
```

***

### P2-10 · 中文字体 Google Fonts 加载阻塞

**文件**：`apps/blog/src/layouts/BaseLayout.astro`

**问题描述**

Ma Shan Zheng / ZCOOL KuaiLe 30MB 字体，3G 网络下 5-10s 才 swap。

**解决方案**

1. `<link rel="preload" as="font" type="font/woff2" crossorigin>` 提前加载
2. Google Fonts CSS2 支持 `&text=` 只加载用到的字符子集
3. 或用 `@fontsource` npm 包本地托管

***

## 长期架构建议

当前架构的根本张力是：**Astro 是 SSG，Payload 是动态**。用"HTML 外壳 + 正则注入 + SSE"缝合，代价就是 P0-3、P0-4、P1-1 这些问题的根源。

**建议二选一**：

**方案 A（推荐，博客更新频率低）**

Payload webhook → 触发 `astro build` → 上传静态产物 → CDN 全缓存

- ✅ 首屏即最新、100% 缓存友好、SEO 完美

- ❌ 发布延迟从 \~5s 变成 1-3 分钟

**方案 B（保留实时）**

修 P0-3、P0-4、P1-1 三处，把当前架构做扎实。

***

## 推荐执行顺序

| 天     | 项                                  | 工作量       |
| ----- | ---------------------------------- | --------- |
| Day 1 | P0-1、P0-2（安全）                      | 40 分钟     |
| Day 2 | P0-4（html-inject 换 parse5）         | 2 小时      |
| Day 3 | P0-3（markdown 管线统一 + sanitize）     | 半天        |
| Day 4 | P1-1（缓存分档）、P1-4、P1-5、P1-6（SEO 三件套） | 半天        |
| Day 5 | P1-2（MusicPlayer/BaseLayout 拆分）    | 半天 + 2 小时 |
| 后续    | P2 系列 + 长期架构决策                     | 视节奏       |

***

## 附录：改造验证用例

### 用例 1：PAYLOAD\_SECRET 缺失时的启动行为（对应 P0-1）

- **输入**：不设 `PAYLOAD_SECRET` 环境变量

- **预期输出**：进程退出，错误信息包含 `"PAYLOAD_SECRET 未配置"`

- **当前实际输出**：静默使用 fallback secret（漏洞）

### 用例 2：Markdown 里包含 `<script>alert(1)</script>` 的渲染（对应 P0-3）

- **输入**：CMS 发布一篇文章，正文是 `hello <script>alert(1)</script> world`

- **预期输出（改造后）**：正文渲染为 `hello &lt;script&gt;alert(1)&lt;/script&gt; world`，浏览器不执行

- **当前实际输出**：`<script>` 标签被允许进入 HTML，浏览器会执行 alert

### 用例 3：html-inject 遇到同名嵌套标签（对应 P0-4）

- **输入**：`<article data-sync-block="postContent"><article>嵌套</article></article>`，注入新内容 `<p>新内容</p>`

- **预期输出**：只有外层 article 的 innerHTML 被替换

- **当前实际输出**：可能在内层 article 提前闭合，破坏结构

### 用例 4：多实例 SSE 同步

- **输入**：Admin 修改一篇文章标题，两个 EdgeOne replica 上都有 SSE 客户端

- **预期输出**：所有客户端在 1s 内收到 update 事件

- **当前实际输出**：单实例内 SSE 有效；跨实例无通知，依赖 30s 轮询兜底

### 用例 5：note id 在时区边界

- **输入**：UTC 时间 2026-09-26T15:30（东八区 2026-09-26 23:30）创建一条 note

- **预期输出（修复后）**：id = `"2026-09-26"`（东八区日期）

- **当前实际输出（若用 UTC）**：id = `"2026-09-26"`；若在 09:26T22:00Z 创建：当前 UTC 会得到 `"2026-09-26"`，但东八区已是 `"2026-09-27"`

***

## 优化建议汇总（按投入产出比排序）

| 优先级  | 项                             | 收益       | 工作量       |
| ---- | ----------------------------- | -------- | --------- |
| P0-1 | PAYLOAD\_SECRET 强校验           | 安全红线     | 10 分钟     |
| P0-2 | Postgres TLS 校验               | 安全       | 30 分钟     |
| P0-4 | html-inject 换 parse5          | 首屏可靠性    | 2 小时      |
| P0-3 | markdown 管线统一 + 可选 sanitize   | 长期维护性    | 半天        |
| P1-1 | 缓存分档                          | 性能 + SEO | 半天        |
| P1-2 | MusicPlayer / BaseLayout 拆分   | 可维护性     | 2 小时 + 半天 |
| P1-3 | SiteSettings textarea → array | 数据正确性    | 半天（含迁移）   |

**推荐执行顺序**：先做 P0-1 / P0-2（安全）→ P0-4（正确性）→ P1-1（性能）→ 其余。P0-3 和 P1-2 可以放到下一个 sprint。
