# 06 · 进度日志：决策、修复与验收记录

## 2026-10-09 · 第一轮（按方案全量执行）

### 一、审计结论（详见 01-audit.md）

项目已高度成熟，方案文档设想的多数改造**已在此前会话中落地**：Payload 为唯一内容源；前台统一 REST 客户端（`payload-api`）+ content loader；CMS 响应时注入 + SSE/30s 轮询局部同步；access 层草稿过滤 + 软删；「填了才显示」的离线兜底规则统一在 shared。

真实缺口集中在 6 处：`siteCreatedAt` 后台字段未接线、死代码（`constants.ts`、`sanitizeInlineHtml`、`getAltMap`）、项目图标默认值三处重复、锚点 id 双份实现、过期描述（cms description / README 徽章）。

### 二、本轮落地与验证

| # | 改动 | 文件 | 验证 |
| --- | --- | --- | --- |
| 1 | `siteCreatedAt` 接线：新增统一出口 `getSiteSince()`（后台留空→不渲染；后台不可用→离线兜底），首页 `SiteAge` 与统计页消费 | `apps/blog/src/lib/site-settings.ts`、`components/SiteAge.astro`、`pages/stats.astro` | **实机回环**：空→DOM 无 `data-site-age`；填 `2026-10-06`→卡片出现且 `data-since="2026-10-06"`；还原→再次隐藏 |
| 2 | 删除死文件 | `apps/blog/src/lib/constants.ts`（grep 零引用） | astro check 0/0/0 |
| 3 | 删除零调用导出 | `shared/html-safety.ts`（`sanitizeInlineHtml` 及其私有辅助，已被 about-format 记号方案取代）、`shared/rehype-img-attrs.mjs`（`getAltMap`） | astro check + tsc 全绿 |
| 4 | 项目图标默认值收敛为单一常量 `DEFAULT_PROJECT_ICON` | `shared/post-utils.ts` → `content.config.ts`、`payload-api.ts`、`blog-sync.ts` | astro check + tsc 全绿 |
| 5 | 锚点 id 单一实现（消除「注释同源、实现双份」） | 新增 `apps/blog/src/lib/anchors.ts`；改 `notes.astro`、`about.astro`、`site-index.ts` | astro check 0/0/0；生成逻辑与改前逐字一致 |
| 6 | 文档一致性 | `apps/cms/package.json` description（SQLite→Postgres）、`README.md` Next 徽章 15→16 | — |
| 7 | 方案文档要求的一套留档 | `docs/refactor/00–06` | 本目录 |

### 三、命令级证据

- `npm run typecheck:cms` → exit 0（改动前后各一次）。
- `PUBLIC_PAYLOAD_URL=http://127.0.0.1:9 npm run typecheck:blog` → Result (37 files): 0 errors / 0 warnings / 0 hints，exit 0。
- `node apps/cms/scripts/verify-html-inject.mjs` → 通过 45 / 失败 0。
- `GET /api/blog-sync?version=1` → 200，返回版本串（同步 API 实际可用）。
- 实机链路：`astro dev(3000) → getSiteSince() → CMS(9527) → Postgres`，三态回环见上表 #1。

### 四、环境插曲（已处理，与代码无关）

- 实机验证期间本地 PG 子进程出现 Windows `0xC0000142`（DLL 初始化失败）导致连接重置；`pg:stop → pg:start` 后恢复，数据完好（posts 9 行），随后全部验证通过。
- 3000 端口上是**用户此前已启动的 astro dev**（PID 9828），本轮直接复用（热载新代码）；我临时启动的 PG 与 9527 后台已在验证后关闭，未留常驻服务。

### 五、未执行 / 未覆盖（诚实边界）

1. 通过 admin 登录路径的「真实人工编辑 → SSE 推送 → 已开页面更新」未跑（本机无管理员凭据）。前台消费侧已用「DB 写入 → loader 取数 → 页面渲染」等价覆盖；SSE/注入机制由 45 例注入断言 + blog-sync API 实测覆盖。
2. 逐页视觉截图对照未做：本轮改动无视觉变更（数据源接线 + 代码整理），构建页与改动前 DOM 结构一致（`SiteAge` 的 DOM 断言即为证据）。
3. 统计页「站点已运行」行位于"无任何内容时"的兜底分支，未单独造空站实测（逻辑为一行分支，风险极低）。

### 六、决策记录

1. **不新建重构分支**：仓库惯例为直进 `dev`，回滚依赖 git 历史 + 基线提交；单独分支反而与本仓库工作流冲突。
2. **不启用 Payload versions/drafts**：现有 `status` 字段 + access 出口过滤 + 软删已满足方案对"草稿/发布/撤回"的要求，记录为限制（无历史版本回溯）。
3. **删除三处零调用代码**（#2/#3）：均先 grep 全仓确认无调用方；符合方案"先验证再删除"纪律，且可随时 `git revert`。
4. **保留现状**：`'uncategorized'`（URL 段）与 `'未分类'`（统计展示）、Nav「更多」固定路由、MOOD/配色表等，理由见 `01-audit.md` §4。
5. **本地 DB 唯一临时写入已还原**：`site_created_at` 空→`2026-10-06`→空，无持久变更。

### 七、遗留（可延期）

- 通过后台 UI 的发布/撤回/删除端到端演练（需管理员账号；建议日常使用中顺带验收）。
- 逐页截图对照（如需要，按 `05-test-plan.md` 执行）。
- 根目录未跟踪文件 `admin.html`、`animals.png` 待用户处置。
- 本轮改动**尚未提交**（按约定等用户确认后提交；`git status` 可见全部改动面）。
