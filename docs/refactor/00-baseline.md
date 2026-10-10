# 00 · 重构前基线与安全准备

> 记录时间：2026-10-09（Asia/Shanghai）· 分支 `dev` · 基线提交 `b343a65`（✨ feat(blog前台): 搜索命令面板/统计页/归档分页/标签墙落地，收编 dev 假数据与页脚配图）

## 1. Git 工作区状态（本轮开始时）

- 分支 `dev`；HEAD = `b343a65`。
- 本会话开始前已存在的未提交项（**属用户既有清理，本轮未触碰**）：
  - 已删除（未暂存）：`.trae/reports/2026-09-26-cms-upgrade.md`、`.trae/reports/2026-09-26-improvements.md`、`.trae/reports/后台UI布局架构解析.md`
  - 未跟踪：`admin.html`、`animals.png`、`apps/blog/public/avatars/logo.png`
- 分支策略：沿用仓库惯例（历史提交全部直进 `dev`），回滚点 = 任意历史提交；未单独建重构分支（理由见 06-progress-log 决策 1）。

## 2. 备份与恢复

| 层 | 备份方式 | 恢复方式 |
| --- | --- | --- |
| 代码 | git 全量历史（基线 `b343a65`） | `git revert <sha>` / `git checkout <sha> -- <paths>` |
| 数据库 | 本地：pg_dump 快照（`D:\pglocal:5433/blog_dev`）；生产：托管库自带快照/时间点恢复 | 本地 `pg_restore` / psql 执行快照；生产走控制台恢复 |
| 媒体 | 追加式写入（Supabase Storage / 本地 `apps/cms/media/`），不覆盖 | 无需回滚 |

> 本轮实测曾把本地 `site_settings.site_created_at` 临时改为 `2026-10-06` 做冒烟，随后**已还原为原值（空串）**，并在数据库侧核验。

## 3. 基线检查结果

| 检查 | 命令 | 改动前 | 改动后 |
| --- | --- | --- | --- |
| CMS 类型检查 | `npm run typecheck:cms`（tsc --noEmit） | ✅ exit 0（15:26 完成） | ✅ exit 0（15:30） |
| 前台检查 | `npm run typecheck:blog`（astro check） | 启动过一版但未在取样窗口内跑完（见注） | ✅ 37 files，0 errors / 0 warnings / 0 hints（15:29–15:30） |
| 注入断言 | `node apps/cms/scripts/verify-html-inject.mjs` | — | ✅ 45/45 通过（15:31） |

注：
- 改动前那次 `astro check` 冷启动耗时超过取样窗口，被主动终止；改动后的全绿结果 + git 历史（`8322af9`「Astro 7 废弃面全量迁移，astro check 从 41 hints 清零」且其后未改检查配置）共同确立基线。
- 检查提速技巧：`PUBLIC_PAYLOAD_URL=http://127.0.0.1:9`（连接立即失败，避免对 9527 的 20s 超时等待），本次即用此法。

## 4. 回滚步骤

1. 代码：`git status` 确认无其它未保存工作 → `git revert` / `git checkout` 回到 `b343a65`。
2. 数据库：本轮**无持久化 schema/数据变更**，无需恢复；如需整体回退，执行第 2 节快照恢复。
3. 媒体：无需操作。
4. 服务：本地按需启停 PG（`npm run pg:start` / `pg:stop`），后台 `npm run dev`，前台 `npm run dev:blog`。
