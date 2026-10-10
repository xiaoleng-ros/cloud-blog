import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除「站点设置 → 关于页」中的五个字段（按用户要求整栏删除，前台回退为写死）。
 *
 *  - about_lead            关于页大标题        → 前台固定「关于我」
 *  - about_eyebrow         大标题上方小标      → 前台固定「ABOUT」
 *  - about_facts           简介行（事实条目）  → 前台固定三行（文章数/起始年按数据现算）
 *  - about_skills_title    「我的小本领」标题  → 前台固定「我的小本领」
 *  - about_note_link_label 项目「笔记」链接文字 → 前台固定「笔记」
 *
 * 至此 PageCopy 机制整体退役（shared/site-defaults 的 PageCopy / OFFLINE_PAGE_COPY /
 * resolvePageCopy / fillCopy 已随本次删除清掉）；关于页仅剩 正文/便签/技能 三个可编辑字段。
 * 列由 20261009_000000_add_page_copy_fields 与更早的 about 字段迁移引入，此处直接 DROP。
 */
const DROPPED_COLUMNS = [
  'about_lead',
  'about_eyebrow',
  'about_facts',
  'about_skills_title',
  'about_note_link_label',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const column of DROPPED_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" DROP COLUMN IF EXISTS ${sql.identifier(column)};`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // 回滚只恢复列结构（值已丢弃，与既往删列迁移同口径：不还原数据）
  for (const column of DROPPED_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS ${sql.identifier(column)} varchar;`)
  }
}
