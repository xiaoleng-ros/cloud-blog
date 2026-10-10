import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除「站点设置」中标签墙 / 统计页 / 搜索页 / 404 页 四个分区的列（共 30 列）。
 *
 * 背景（2026-10-10）：用户要求把这些分区连同代码整体删除，相关文案恢复为前台写死
 * （见 tags/index.astro、stats.astro、search.astro、404.astro 与 blog-render.tsx；
 * 标签墙计数、统计卡片/逐年列表/更新行等动态数字仍走同步区块）。
 * 列由 20261009 迁移引入，此处直接 DROP。
 */
const DROPPED_COLUMNS = [
  // 标签墙
  'tags_eyebrow',
  'tags_page_title',
  'tags_page_intro',
  'tags_count_label',
  'tags_empty_text',
  // 统计页
  'stats_eyebrow',
  'stats_page_title',
  'stats_page_intro',
  'stats_card_posts',
  'stats_card_words',
  'stats_card_tags',
  'stats_card_notes',
  'stats_categories_title',
  'stats_tagwall_title',
  'stats_years_title',
  'stats_empty_posts',
  'stats_empty_tags',
  'stats_empty_years',
  'stats_update_label',
  // 搜索页
  'search_eyebrow',
  'search_page_title',
  'search_page_intro',
  'search_placeholder',
  'search_button_label',
  // 404 页
  'not_found_eyebrow',
  'not_found_title',
  'not_found_text',
  'not_found_home_label',
  'not_found_search_label',
  'not_found_archive_label',
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
