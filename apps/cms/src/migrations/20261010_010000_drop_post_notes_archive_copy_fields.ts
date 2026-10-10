import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除「站点设置」中文章页 / 随笔页 / 归档与分类标签页 三个分区的列（共 22 列）。
 *
 * 背景（2026-10-10）：用户要求把这三个分区连同代码整体删除，相关文案恢复为前台写死
 * （见 posts/[...slug].astro、notes.astro、archive/[...page].astro、categories|tags 页
 * 与 blog-render.tsx）。列由 20261009 迁移引入，此处直接 DROP。
 */
const DROPPED_COLUMNS = [
  // 文章页
  'post_back_home',
  'post_updated_label',
  'post_reading_label',
  'post_prev_label',
  'post_next_label',
  'post_related_title',
  'post_toc_title',
  'post_comments_title',
  // 随笔页
  'notes_eyebrow',
  'notes_page_title',
  'notes_page_intro',
  'notes_time_title',
  'notes_empty_text',
  'notes_comments_title',
  // 归档与分类标签页
  'archive_eyebrow',
  'archive_page_title',
  'archive_intro_text',
  'archive_categories_title',
  'archive_tags_title',
  'archive_empty_text',
  'category_count_label',
  'tag_count_label',
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
