# 云上笔记后台升级建议清单

> 生成日期：2026-09-26
> 范围：`apps/cms`（Payload CMS 3.88 + Next.js 15 后台）
> 目的：把当前后台在**代码 / UI / 表单 / 功能 / 运维**五个维度的可改进项盘点清楚，作为下一轮迭代的选题池
> 状态：**仅盘点，未修改任何代码**

---

## 目录

- [关键结论](#关键结论)
- [P0 · 影响安全或正确性](#p0--影响安全或正确性建议本周修完)
- [P1 · 影响开发体验](#p1--影响开发体验下一个迭代做)
- [P2 · 锦上添花](#p2--锦上添花有余力再做)
- [推荐执行顺序](#推荐执行顺序)
- [附录 A：涉及文件清单](#附录-a涉及文件清单)
- [附录 B：命名与规范约定](#附录-b命名与规范约定)

---

## 关键结论

后台功能完整度对"能写、能发、能看"已经够用，问题集中在**信任面**（秘钥/权限/TLS）和**结构性负债**（1350 行的 `blog-render.tsx`、1725 行的 `admin-theme.css`、僵尸依赖 `lexicalEditor`）。

- **代码类 P0**：5 条（秘钥兜底 / TLS 校验 / access 权限 / blog-render XSS / 无 CI 无 rate limit）
- **UI 类 P0**：1 条（`CustomNav` 4 个图标全部指向同一张图，视觉分组完全失效）
- **表单 / 功能 / 运维**：以 P1/P2 为主，多为可组合上线的能力补强

按"改 1 条 = 修 1 个真实漏洞"的口径，**本周至少应清掉 P0-A/B/C/F 四条**。

---

## P0 · 影响安全或正确性（建议本周修完）

### P0-A · PAYLOAD_SECRET fallback 可绕过校验

**文件**：`apps/cms/src/payload.config.ts`（L111-L157）

**现状**

```ts
const PAYLOAD_SECRET_FALLBACK = 'clay-blog-dev-secret-key-2026-random-string-change-in-production'
const payloadSecret = providedSecret || PAYLOAD_SECRET_FALLBACK
```

默认不回抛错，仅当 `PAYLOAD_REQUIRE_SECRET=1` 才强校验。生产环境一旦漏配，服务能起来，只是打 `console.error` 横幅，攻击者可以拿到公开代码里的字符串伪造 admin cookie。

**方案**

1. 新增 `/admin/health` 只读端点，返回 `{ usingFallback, usingWeakSecret }`
2. EdgeOne 部署流水线的 `pre-deploy` 阶段调用它，命中 fallback 直接 fail
3. 灰度期结束后默认 `PAYLOAD_REQUIRE_SECRET=1`

---

### P0-B · Postgres SSL 默认关闭证书校验

**文件**：`apps/cms/src/payload.config.ts`（L187-L201）

**现状**

```ts
const PG_SSL_STRICT = process.env.PG_SSL_STRICT === '1'
// 默认：sslmode=no-verify
```

默认走 `sslmode=no-verify`，EdgeOne 出站 TLS 被中间人截（业务上已验证过）。但**默认**应该是 strict，兼容模式应该靠环境变量显式开启。

**方案**

1. 拿到 Supabase 官方 CA 后，把默认翻为 `strict`（`sslmode=prefer` + `rejectUnauthorized: true`）
2. 保留 `PG_SSL_STRICT=0` 作为临时兜底
3. 灰度一个环境验证再全量切

---

### P0-C · 6 个集合都没有 access 权限钩子

**文件**：`apps/cms/src/collections/{Posts,Notes,Categories,Tags,Media,Projects}.ts`

**现状**：登录用户能读写所有集合，`Users` 集合也没有 `access.update = self` 约束。多账号场景立刻崩。

**方案**

```ts
// 每个业务集合统一挂
access: {
  read: () => true,
  create: () => ({ id: { equals: req.user?.id } }),
  update: () => ({ id: { equals: req.user?.id } }),
  delete: ({ req }) => req.user?.role === 'admin',
}
```

---

### P0-D · blog-render.tsx 1350 行且无 HTML sanitize 边界

**文件**：`apps/cms/src/lib/blog-render.tsx`

**现状**：单文件里塞了 Markdown 解析、HTML 组件、样式，Markdown 渲染开启了 `allowDangerousHtml: true`（沿用自更早的报告），但没有 `rehype-sanitize`。

**方案**

1. 拆包：`lib/blog-render/{parser.ts, renderer.tsx, components/, styles.ts}`
2. 出口挂 `rehype-sanitize`，用白名单 schema
3. 组件层用 `useMemo` 稳定子树，避免每次 keystroke 全量重渲

---

### P0-E · 无 CI / 无 rate limit / 无结构化日志

**现状**：仓库根 `package.json` 里没有任何 `lint` / `test` / `typecheck` 脚本；`/api/blog-sync` 无 IP 频控；`console.log` 打散在业务代码里。

**方案**

1. `.github/workflows/lint.yml`：`lint` + `typecheck` + `verify:html-inject`
2. `/api/blog-sync` 加 IP 令牌桶（60 次/分）
3. `console.*` → `pino` 实例，带 request id

---

### P0-F · CustomNav 4 个图标全部指向同一张图

**文件**：`apps/cms/src/admin/components/CustomNav.tsx`（L25-L30）

**现状**

```ts
const cloudImages: Record<CloudIconKey, string> = {
  blueIcon: '/cloud-icons/cloud-dark.png',
  dark:     '/cloud-icons/cloud-dark.png',
  darkBg:   '/cloud-icons/cloud-dark.png',
  whiteOutline: '/cloud-icons/cloud-dark.png',
}
```

视觉分组完全没起作用，看起来"整个后台都是同一个云图标"。

**方案**

- 30 分钟版：上传 4 张真正不同的图到 `public/cloud-icons/`
- 长期版：切到 `lucide-react` 内联 SVG，取消位图依赖

---

## P1 · 影响开发体验（下一个迭代做）

### 代码

| ID | 问题 | 文件 | 方案 |
|----|------|------|------|
| P1-A | `depth:1` 关系展开引发 N+1 | `lib/blog-sync.ts`, `lib/sync-cache.ts` | 改 `join` + `populate:false` 手动组装 |
| P1-B | `import-markdown.ts` 无 dry-run、无校验报告 | `scripts/import-markdown.ts` | 加 `--dry-run` + 结构化 JSON 报告 |
| P1-C | `lexicalEditor()` 注册但项目实际用 `Vditor`，是僵尸依赖 | `payload.config.ts` + `editor/MarkdownEditor.tsx` | 从 config 移除，`package.json` 卸载 `@payloadcms/richtext-lexical` |

### UI

| ID | 问题 | 文件 |
|----|------|------|
| P1-D | 主题色冲突：ComposeView 用深绿 `#1c3b27`，其他页用粉 `#e85a7a` | `admin-theme.css` |
| P1-E | 多处 `window.alert()` / `confirm()` 阻塞且与主题不搭 | `PublishModal.tsx`, `DraftsViewInner.tsx` |
| P1-F | CustomNav 折叠状态未持久化，刷新丢失 | `CustomNav.tsx` |
| P1-G | `admin-theme.css` 1725 行单文件，无模块化 | `admin-theme.css` |

**方案**：D 收拢到 CSS 变量 `--brand-primary / --brand-accent`；E 换 `@payloadcms/ui` 的 `Toast`；F 用 `localStorage` 缓存；G 拆 `layout/nav/forms/views/components` 五个子目录。

### 表单

| ID | 问题 | 方案 |
|----|------|------|
| P1-H | `NavItemsField.tsx` / `SocialLinksField.tsx` 用 `textarea` 存结构化 JSON，编辑极易破坏 | 改成 Payload 的 `ArrayField` |
| P1-I | URL 类字段（GitHub/Bilibili/导航链接）无格式校验 | 加 `validate: (v) => /^https?:\/\//.test(v)` |
| P1-J | `SlugInput` 无唯一性校验 | 字段加 `index: { unique: true }` + 表单端 debounce 查重 |
| P1-K | Posts 的封面/标签/分类无 `required` / `minRows` | 补齐约束，避免"空文章"上线 |

### 功能

| ID | 问题 | 方案 |
|----|------|------|
| P1-L | 草稿/发布/归档状态未显式建模 | 加 `status: draft\|published\|archived` 字段 + 状态切换 UI |
| P1-M | 无 SEO / Open Graph 字段 | 每篇补 `seoTitle / seoDesc / ogImage / twitterCard` |
| P1-N | 改 slug 后老 URL 直接 404，无重定向 | 加 `redirectFrom` 字段 + `middleware.ts` 补 301 |
| P1-O | 无搜索（列表全量拉） | 加 `filterable: true` + 顶部搜索框 |

---

## P2 · 锦上添花（有余力再做）

### 功能

- **P2-A** 版本控制：`versions: { drafts: true, limit: 10 }`
- **P2-B** 定时发布：`publishDate` 字段 + cron job
- **P2-C** 评论系统（Giscus / Waline / 自建）
- **P2-D** 全文搜索（Meilisearch / Typesense 插件）
- **P2-E** RSS / Atom / JSON Feed 出口
- **P2-F** 数据导出（CSV / JSON / Markdown bundle）
- **P2-G** API Token 管理后台
- **P2-H** 多角色权限（`roles` 全局 + 按集合授权）
- **P2-I** 站内公告 / 更新日志

### UI

- **P2-J** 暗色 / 亮色主题切换
- **P2-K** 仪表盘增加"最近编辑 / 待发布 / 30 天流量"精细图表
- **P2-L** 键盘快捷键 + `Cmd+K` 命令面板
- **P2-M** 移动端后台适配

### 表单

- **P2-N** 文章封面自动裁剪预览（3:2 / 16:9 / 1:1）
- **P2-O** Markdown 编辑器内嵌实时预览
- **P2-P** 分类 / 标签自动补全
- **P2-Q** SEO 填写度打分

### 运维

- **P2-R** `/healthz` 健康检查（DB / Storage / Secret 都探一遍）
- **P2-S** Sentry 接入
- **P2-T** GitHub Actions：`lint` + `typecheck` + `test` + `verify:html-inject`

---

## 推荐执行顺序

1. **本周**：P0-A + P0-B + P0-F + P0-E（CI）——最小工作量、直接堵住信任面漏洞
2. **下个迭代**：P1-A + P1-C + P1-H / I / J——清僵尸依赖、补唯一性、结构化表单
3. **中期**：P1-L + P1-M + P1-N 三件套——状态、SEO、重定向组合起来博客才真正"能上线运营"
4. **长期**：P2 系列按需挑

---

## 附录 A：涉及文件清单

**代码类**

- `apps/cms/src/payload.config.ts`
- `apps/cms/src/lib/blog-render.tsx`
- `apps/cms/src/lib/blog-sync.ts`
- `apps/cms/src/lib/sync-cache.ts`
- `apps/cms/src/scripts/import-markdown.ts`
- `apps/cms/src/collections/{Posts,Notes,Categories,Tags,Media,Projects,Users}.ts`
- `apps/cms/src/globals/{SiteSettings,Navigation}.ts`
- `apps/cms/src/app/api/blog-sync/route.ts`
- `apps/cms/src/middleware.ts`

**UI 类**

- `apps/cms/src/admin/components/{CustomNav,CloudLogo,SlugField,NavItemsField,SocialLinksField}.tsx`
- `apps/cms/src/admin/views/{DashboardView,AccountView}.tsx`
- `apps/cms/src/admin/views/write/{ComposeView,PostComposeView,NoteComposeView,PublishModal,SlugInput}.tsx`
- `apps/cms/src/admin/views/drafts/{DraftsView,DraftsViewInner}.tsx`
- `apps/cms/src/app/(payload)/admin-theme.css`

**功能 / 运维类**

- `apps/cms/src/app/(payload)/admin/[[...segments]]/page.tsx`
- `apps/cms/edgeone.json`
- `.github/workflows/*.yml`（待新建）

---

## 附录 B：命名与规范约定

按项目既有规则（见用户规则）：

- **TypeScript / JSX**：变量函数用 `camelCase`，类型用 `PascalCase`，常量用 `UPPER_SNAKE_CASE`
- **文件名**：组件用 `PascalCase.tsx`，工具类用 `camelCase.ts`
- **CSS 类名**：`admin-theme.css` 内已用 `nav-group__toggle` 双下划线的 BEM 变体，保持一致
- **注释**：全部中文，覆盖函数功能 / 参数 / 返回值 / 关键逻辑
- **提交规范**：`emoji 类型(模块): 描述`，只推 `dev` 分支，除非明确要求 `main`

---

**下一步**：告诉我要先做哪一条，我按"需求分析 → Mermaid 流程图 → 核心逻辑伪代码 → 测试用例"四段式出方案后开工。
