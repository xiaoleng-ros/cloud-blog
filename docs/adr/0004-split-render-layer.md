# 0004 拆分服务端渲染层，并用输出比对守住等价性

- 状态：已采纳
- 日期：2026-11-13

## 背景

`apps/cms/src/lib/blog-render.tsx` 承担了整个博客前台的服务端渲染：把 Payload 最新数据渲染成
与 Astro 静态构建**完全一致**的 HTML 区块，供两处消费——

1. `apps/cms/src/app/api/blog-sync/route.ts` → 客户端轮询/SSE 后 `innerHTML` 局部替换；
2. `apps/cms/src/app/[[...path]]/route.ts` → 响应 HTML 前直接注入，保证首屏即最新数据。

这个文件在拆分前是 **2192 行、133 个顶层声明**（92 个可识别的顶层声明）。它同时包含
markdown 渲染管线、配色算法、图标、站点设置解析、以及 9 个页面的区块聚合器。
改首页的 hero 卡片时，要在一个文件里翻过归档分页器和统计页标签墙。

更麻烦的是，这个文件**没有测试**。它的输出就是线上 HTML，任何手改都没有回归网。
这正是它一直没被拆的真实原因：拆了却证明不了「只搬家、没改行为」，就是拿线上首页赌一把。

## 决策

按页面职责拆成 `apps/cms/src/lib/render/` 下 15 个子模块，`blog-render.tsx` 退化为 167 行门面，
只保留按路径分发（`renderBlocksForPathname`）、旧 URL 规范路径解析（`resolveLegacyPostPath`、
`parsePostSegment`），并 re-export `buildSiteIndex` 以保持 `src/app/site-index.json/route.ts` 的
既有 import 不变。

同时新增 `apps/cms/scripts/verify-render-parity.mjs`，把「拆分前后输出逐字相同」变成可执行断言，
并接入 `build:all`、edgeone `buildCommand` 与 CI。

模块划分（每个文件都是一类职责，不再按行数切）：

| 文件                       | 职责                                  |
| -------------------------- | ------------------------------------- |
| `render/config.ts`         | `SITE_DEFAULTS` / `site` / `SyncData` |
| `render/util.ts`           | 转义、日期、文章路径                  |
| `render/palette.ts`        | 分类/标签配色与哈希分槽               |
| `render/icons.ts`          | `iconSvg`                             |
| `render/site-settings.ts`  | Hero / 社交 / 页脚 / 头像 / ICP 解析  |
| `render/markdown.ts`       | markdown 管线 + shiki 高亮            |
| `render/blocks-home.ts`    | 首页 + 通用页头页脚                   |
| `render/blocks-post.ts`    | 文章详情页                            |
| `render/blocks-archive.ts` | 归档页                                |
| `render/blocks-notes.ts`   | 随笔页                                |
| `render/blocks-term.ts`    | 分类/标签词条页                       |
| `render/blocks-stats.ts`   | 统计页                                |
| `render/blocks-about.ts`   | 关于页                                |
| `render/blocks-friends.ts` | 友链页                                |
| `render/site-index.ts`     | 站内搜索索引                          |

## 关键取舍

### 用摘要基线而不是全量 HTML 存基线

`scripts/render-parity/baseline.json` 存的是每个区块 HTML 的 sha256 前 16 位，不是原文。
全量基线 279 KB，diff 时无从阅读。存摘要后，一条差异就是一行「区块 X 输出变了」，
足够定位到具体文件；真要逐字对比再让脚本打印当前输出。

### 不启动 Next、不连数据库

渲染层的 import 链末端是 `blog-sync` → `@payload-config` → Payload 运行时 → 数据库。
`scripts/render-parity/loader.mjs` 是一个 ESM `resolve` 钩子：只拦渲染层对 `blog-sync` /
`sync-cache` 的引用，换成 `sync-stub.ts`，快照通过 `__setSync()` 注入。其余 import 原样放行，
只用两件补全——把 `cloud-blog/shared/x` 指到仓库 `shared/` 目录，以及给无扩展名相对路径补 `.ts`。

于是校验跑的是**源码本身**，不是副本。这一点很重要：早先尝试过生成 `blog-render.probe.ts`
副本再 import，副本会过期，改坏的地方被陈旧副本掩盖。

### 两个 `.tsx` 文件其实没有 JSX

Node 22 的内置类型剥离只认 `.ts`/`.mts`，遇到 `.tsx` 会 `ERR_UNKNOWN_FILE_EXTENSION`。
`blog-render.tsx` 与 `route.ts` 引用的都是纯字符串函数，一行 JSX 都没有（历史命名）。
loader 对 `.tsx` 直接按 `module-typescript` 交给 Node 剥离。若将来真写进 JSX，解析会当场报错，
不会静默跑错——这是可以接受的失败方式。

### 拆分时把 `mdSanitizeSchema` 位置问题暴露了

原文件第 67 行是 `const mdSanitizeSchema = ...`，但它后面还跟着 4 组 import 语句。
第一版切割器假设「import 全在文件头」，把这些 import 当成了正文，产出文件全部无法解析。
改成状态机式剥离（逐行判断是否处于 import 语句中）后才正确。这也说明原文件的结构本身是乱的。

### 等价性怎么证明

分两步，都做过：

1. 拆分前用原始 2167 行文件跑 `render-cases` 生成基线（45 个用例全部成功，索引 34 条）；
2. 拆分后跑同一个脚本生成第二份结果，`JSON` 逐字节比对 → `字节一致: true`（266,639 字符）；
3. 固化后，把门面临时换回拆分前的 2167 行原文件，跑 `verify-render-parity.mjs` → 同样通过。

第 3 步是关键：它证明基线描述的是「行为」而不只是「拆分后的实现」。

### 剩下几个巨型文件为什么没拆

- `apps/blog/src/components/MusicPlayer.astro`（3050 行）：`<style>` 与 `<script>` 在 Astro 里
  有作用域语义，抽成子组件会改变选择器作用域和脚本执行时机（播放器状态机、事件监听都挂在
  `document` 上）。收益是可读性，代价是可能引入「某台设备上歌单不播」这类只在真机上复现的问题。
  没有渲染输出比对手段之前不动它。
- `apps/blog/src/styles/global.css`（5390 行）：拆成 `@import` 分层会改变 cascade 顺序，
  而该文件里有大量依赖书写顺序覆盖规则（同一选择器多处定义）。CSS 没有等价性校验，
  拆错的代价是全站视觉错乱，收益只是「文件短一点」。不做。
- `apps/cms/src/admin/views/settings/SettingsEditView.tsx`（994 行）、
  `NavigationEditView.tsx`（993 行）：后台表单视图，两文件结构高度相似（草稿状态 + 分组字段 +
  保存/重置），确实值得抽公共件。但它们是 React 组件，拆分需要人工搬 JSX 与 hook，
  没有像渲染层那样现成的输出比对网。**下一步该做，但不是这次**——先把渲染层的模式跑通。

## 后果

- 收益：单文件最大 336 行（`blocks-home.ts`），按页面找代码不再需要跨全文件搜索；
  改动任何区块都有 45 个用例的输出比对兜底；新增页面时照着既有 `blocks-*.ts` 加即可。
- 代价：多 15 个文件与一层 indirection；模块间依赖由相对路径维护，加新依赖要手动补 import
  （漏了会被 typecheck 与运行时的「找不到导出」同时拦下）。
- 门槛：`verify-render-parity.mjs` 需要 Node ≥ 22.18（内置类型剥离默认开启）。低于该版本会因
  `ERR_UNKNOWN_FILE_EXTENSION` 直接失败，不会静默跳过。当前 `edgeone.json` 的
  `nodeVersion` 是 `22.21.1`，CI 用 `node-version: 22`。
- 改渲染层且**确认输出变化是预期的**，跑 `node apps/cms/scripts/verify-render-parity.mjs --update`
  重算基线，并在提交信息里写清为什么变。
