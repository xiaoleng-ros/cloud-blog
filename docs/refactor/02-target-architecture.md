# 02 · 目标架构与职责划分

> 本文件描述**目标架构**及其在本仓库中的**实际落地形态**（二者已一致，除少量遗留项已列入 04-migration-plan.md）。
> 原则：以现有 Astro UI 为基准，以 Payload 作为内容的唯一管理入口，以清晰的数据访问层连接前后台。

## 1. 目标数据流（对照方案文档二节）

```text
Payload 后台（apps/cms）
  ├─ 内容：posts / notes / projects / categories / tags
  ├─ 全局配置：site-settings（站点信息/Hero/社交/页脚/关于/网站配置）、navigation
  ├─ 媒体：media（Supabase S3 或本地磁盘）
  └─ 定制管理视图：文章/随笔/草稿箱/回收站/分类树/标签/评论/站点设置
        │
        ▼
Postgres（本地 5433 / 生产托管库）+ 集合级权限（匿名只读 published；写操作需登录）
        │
        ▼
统一数据层
  ├─ CMS 侧：lib/blog-sync（取数/快照/指纹）→ lib/blog-render（区块 HTML）→ lib/html-inject（注入静态外壳）
  │          lib/sync-cache（缓存 + SSE 广播，afterChange/afterDelete 钩子统一失效）
  └─ 前台侧：apps/blog/src/lib/payload-api.ts（REST 客户端）→ payload-loader.ts（content loader）→ site-settings.ts（设置读取/解析）
        │
        ▼
Astro 页面与组件（apps/blog/src/pages/**，保持现有 UI 与交互）
        │
        ▼
浏览器：SSE /api/blog-sync/stream（主）+ 30s 轮询（兜底）→ 按 data-sync-block 锚点局部替换区块
```

## 2. 职责划分（实际）

| 角色 | 职责 | 实现位置 |
| --- | --- | --- |
| Payload | 内容模型、后台表单、媒体管理、字段校验、权限、发布状态 | `apps/cms/src/{collections,globals,payload.config.ts}` |
| Next.js 服务端 | 响应时注入最新区块、SSE/轮询接口、评论桥、账号与飞书登录、预览 CSS | `apps/cms/src/app/**`、`src/lib/**` |
| shared/ | 前后台共用纯函数（日期/归档/关于格式/图标表/净化 schema/短代码插件） | `shared/*` |
| Astro | 页面结构、视觉呈现、响应式与交互；经统一数据层取数 | `apps/blog/src/**` |
| 数据库 | 持久化；迁移一律手写并按登记流程（`apps/cms/src/migrations/`） | Postgres |

**无独立 Node.js 后端**：不存在与 Payload 重复的 CRUD 接口（方案「核心原则 2/3」）。

## 3. 关键机制（当前生效）

### 3.1 取数与缓存

- 构建期（astro build）：loader 通过 `payload-api.ts` 拉取 posts/notes/projects（`limit=0` 全量）与 globals；失败时回退本地 Markdown/dev 假数据并打印告警。
- 运行期（页面打开后）：浏览器订阅 SSE；断流时 30s 轮询 `/api/blog-sync?path=`；服务端 5s TTL 快照 + single-flight 防击穿；集合钩子 `afterChange/afterDelete` → `invalidateAll()` + SSE 广播。
- 首屏：catch-all 先取 `public/__blog/` 静态外壳，再用 parse5 注入最新区块（`data-sync-version` 与服务端版本比对，避免重复改写）。

### 3.2 发布与草稿语义

- 发布 = `status: 'published'`（默认 `draft`）；字符串枚举，无 Payload versions。
- 匿名读过滤在 access 层统一实施（`lib/access.ts:publishedOnlyForAnonymous`），blog-sync 查询亦带 `status=published` 条件——草稿不会经任何公开链路泄露。
- 撤回 = 改回 `draft`（等价下架）；删除 = 软删（`deletedAt`，回收站可恢复）。
- 前台更新延迟上界：SSE 即时（单实例）；多实例靠 5s TTL + 30s 轮询，最终一致。

### 3.3 静态外壳与重建边界（重要）

- 静态外壳只在构建时生成（`npm run build:all` 或 `npm run sync:blog`）。
- **已有外壳的页面**：数据变更由响应时注入 + SSE 实时生效，无需重新构建。
- **新增/删除文章路径、新增页面**：必须先重新构建（否则新路径 404 / 旧路径留壳）。这是部署流程约束，不是代码缺陷。

### 3.4 「填了才显示」统一规则

- 后台可用、字段留空 → 前台为空（不渲染该项）。
- 仅当后台整体不可用（`settings === null`）→ 使用 `shared/site-defaults.ts` 的离线兜底。
- 同一份默认值前后台唯一来源（shared），避免两侧抄写漂移。

## 4. 数据流关键文件索引

| 关注点 | 文件 |
| --- | --- |
| 前台 REST 客户端与类型转换 | `apps/blog/src/lib/payload-api.ts` |
| 前台 content loader（轮询/兜底/缓存） | `apps/blog/src/lib/payload-loader.ts` |
| 前台设置读取与解析（TTL 60s） | `apps/blog/src/lib/site-settings.ts` |
| 共享工具（日期/归档/关于格式/站点统计/运行时长） | `shared/{post-utils,about-format,site-stats,site-age,site-defaults}.ts` |
| CMS 数据层 | `apps/cms/src/lib/blog-sync.ts` |
| CMS 缓存与 SSE | `apps/cms/src/lib/sync-cache.ts` |
| CMS 区块渲染 | `apps/cms/src/lib/blog-render.tsx` |
| 注入 | `apps/cms/src/lib/html-inject.ts`、`apps/cms/src/app/[[...path]]/route.ts` |
| 访问控制 | `apps/cms/src/lib/access.ts` |

## 5. 与方案文档的偏差说明

| 方案假设 | 实际 | 结论 |
| --- | --- | --- |
| 存在独立 Node.js 后端 | 无；Next route handlers 即服务端 | 符合「避免重复 CRUD」原则，无需改造 |
| 可能需要 SSR/静态混合决策 | 已定为「静态外壳 + 响应时注入 + 客户端同步」的混合模式 | 已实现并文档化，维持 |
| 迁移期间可能有双数据源兼容 | 仅 dev 假数据（构建不读）；本地 Markdown 兜底为空 | 无双生产源 |
