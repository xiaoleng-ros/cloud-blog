import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除「站点设置 → 首页文案」分区的 4 列。
 *
 * 背景（2026-10-10）：用户要求把该分区连同代码整体删除，4 项恢复为前台写死文案
 * （最新文章标题/精选标签/全部文章链接文案/运行时间卡标题，见 index.astro、
 * SiteAge.astro 与 blog-render.tsx）。列由 20261009 迁移引入，此处直接 DROP。
 */
const DROPPED_COLUMNS = [
  'home_latest_title',
  'home_featured_label',
  'home_all_posts_label',
  'home_site_age_title',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const column of DROPPED_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" DROP COLUMN IF EXISTS ${sql.identifier(column)};`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // 回滚只恢复列结构（值已丢弃，与 20261009 的 down 同口径：不还原数据）
  for (const column of DROPPED_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS ${sql.identifier(column)} varchar;`)
  }
}
