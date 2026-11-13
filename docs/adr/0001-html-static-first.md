# 0001 · HTML 静态优先：构建期预渲染 + 静态层直出

- **状态**：已采纳（部分待线上验收）
- **日期**：2026-11-13
- **影响范围**：`apps/cms/edgeone.json`、`apps/cms/scripts/prerender-blog-shells.mjs`、`apps/cms/src/app/[[...path]]/route.ts`（未改动）

## 背景

全站 HTML 由 `apps/cms/src/app/[[...path]]/route.ts` 这个 catch-all Route Handler 产出：
读取 `apps/cms/public/__blog/` 里的 Astro 外壳，按最新数据渲染 `data-sync-block` 区块，
注入后经 `apps/cms/src/lib/html-compress.ts` 的 brotli 压缩返回。该函数硬编码
`Cache-Control: no-store`，且 `export const dynamic = 'force-dynamic'`。

线上实测（2026-10-31，HTTP/2 直连）：

| 资源                                   | 边缘缓存                 | 压缩 | 字节      | TTFB                   |
| -------------------------------------- | ------------------------ | ---- | --------- | ---------------------- |
| `/`                                    | `Cache Miss`（每次回源） | 无   | 145,758 B | 2,500–3,000 ms         |
| `/__blog/index.html`（同内容静态副本） | `Cache Hit`（age 41）    | br   | 45,373 B  | 200–210 ms             |
| `/api/blog-sync?version=1`             | `Cache Miss`             | —    | 114 B     | 390–700 ms（函数地板） |

即：同一份 HTML，走静态层 ≈ 200 ms / 40 KB，走函数 ≈ 2,500 ms / 145 KB。

## 决策

**把每个需要注入的页面在构建期渲染成真正的静态文件，落到 `apps/cms/public/<path>/index.html`，
交由 EdgeOne 的「静态资源优先于函数」规则直出；catch-all 函数保留为兜底**（处理旧 URL 301、
重定向壳、未静态化的路径）。

## 关键取舍

### 1. 不采用「构建期抓线上已注入 HTML」

`docs/perf/00-加速方案.md` §4 最初设想对每个 URL 抓一次线上 HTML 落盘。**否决**：
抓下来的是**上一版部署**的产物，里面引用的是上一版的 `_astro/*` 哈希文件名，
而新构建会重新生成带新哈希的 CSS/JS → 静态页面指向不存在的资源，全站无样式。
此外它要求构建机公网可达，把构建变成依赖网络的非幂等操作。

### 2. 不采用「构建期调用 renderBlocksForPathname 渲染」

该函数链最终 `import` 了 `payload` 与 `@payload-config`（见 `apps/cms/src/lib/blog-sync.ts:14-15`），
执行 TS 需要 `tsx`，而 `tsx` 依赖 esbuild 的 spawn 子进程，在受限环境下直接
`Error: spawn EPERM`。构建机上同样不可靠 → **否决**。

### 3. 采用「复制 Astro 构建产物 + 补 version 属性」

`apps/blog/dist` 里每个页面的 `data-sync-block` 锚点内**已经烘焙了构建期从 Payload 拉到的真实数据**
（例如 `data-sync-block="heroCount"` 里是「全部 1 篇」而不是模板占位）。也就是说
dist 产物本身就是「外壳 + 最新数据」，其 `_astro` 引用与本次构建天然一致。

因此脚本只做两件事：

1. 把 `public/__blog/<rel>/index.html` 复制到 `public/<rel>/index.html`；
2. 给所有 `data-sync-block` 锚点补 `data-sync-version="<构建时间戳>"`。

第 2 步是必需的：客户端 `apps/blog/src/layouts/BaseLayout.astro:1088` 的判断是
`if (version && el.dataset.syncVersion === version) return false`。不带该属性，首屏会把
13 个区块全部重写一遍（内容相同但白白多一次 DOM 替换与重排）。

### 4. 两个必须跳过的守卫

| 跳过对象                    | 判定                                                   | 原因                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posts/<纯数字>/index.html` | `/^posts\/\d+\/index\.html$/`                          | 旧 URL 形态由 `route.ts:409-420` 调 `resolveLegacyPostPath` 做**真 301** 到 `/posts/daily/<id>`。一旦静态化，静态文件会抢先命中，301 被彻底绕过，旧链接全部变成 200 重复内容 |
| meta-refresh 重定向壳       | `/http-equiv=["']?refresh/i.test(html.slice(0, 1024))` | `/projects` 的壳实际是「跳转到 /about」的占位页；静态化它没有意义，且会固化一次跳转                                                                                          |

早期版本还有一条「没有 `data-sync-block` 锚点就跳过」的守卫，**是错的**：
纯静态页本来就没有锚点，静态化它反而是最优解（永远不需要运行时注入）。已删除。

### 5. 执行顺序硬约束

`prerender-blog-shells.mjs` 必须在 `copy-blog-to-public.mjs` **之后**执行。后者每轮会
`rmSync` 整个 `public/__blog/` 重建（首次无清单时还会清 public 根下所有 .html），
顺序反过来会被整体抹掉。

### 6. `edgeone.json` 暂不加 `rewrites`

已确认 `public/<dir>/index.html` 会被 `/<dir>` 命中（实测 `/__blog/about` → 200 + br + Cache Hit），
但 **`public/index.html` 会不会被 `/` 命中，本地无法验证**（本机无外网）。
EdgeOne Makers 的 `edgeone.json` 是否支持 `rewrites` 字段也无法在本地确认（仓库内无先例）。
盲加一个不被支持的字段可能让部署直接失败，因此选择先不动，按 README「部署后必做的一次验收」
用 `curl` 判定，不命中再加。这比一次失败的部署更省时间。

## 后果

- **收益**：命中静态层的页面从 2,500 ms / 145 KB 降到 ≈ 200 ms / 40 KB。
- **代价**：静态副本与最新数据之间存在一次构建周期的延迟。内容更新的实时性由客户端
  SSE + 30s digest 轮询兜底（`apps/blog/src/layouts/BaseLayout.astro` 的 sync 客户端），
  用户在页面停留时会自动换成最新区块，无需刷新。
- **不可回退的边界**：如果将来引入「只对登录用户可见」的动态内容，不能走静态化路径。

## 复现 / 验收

`apps/cms/scripts/prerender-blog-shells.mjs` 当前产出 13 页，清单写在
`apps/cms/public/.prerender-manifest.json`（用于清理上一轮的残留页面）。
线上验收命令与判定表见 README 的「📌 部署后必做的一次验收」一节。
