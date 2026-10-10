import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：为 site_settings 表补上「页面文案」列（首页/文章页/随笔页/归档与分类标签页/
 * 标签墙/统计页/搜索页/404 页 + 关于页与页脚的补充字段），共 61 列。
 *
 * 背景：这些文案原先是前台模板里的硬编码，现全部上收到后台「站点设置」对应分区
 * （见 globals/SiteSettings.ts 与 admin/views/settings/SettingsEditView.tsx）。
 *
 * 数据预填：新增列一律先用站点上线时的原文案填充（COALESCE 只填 NULL），
 * 保证「部署后前台外观与改版前逐字一致」、后台一打开就能看到可编辑的现文案。
 * 之后用户在后台留空某字段 → 前台该项不渲染（全站统一「填了才显示」规则）。
 *
 * 列名与 globals/site_settings 的 snake_case 落库形态一致（对齐 payload generate:db-schema 输出）。
 */
export const COPY_COLUMNS: Array<[string, string]> = [
  // 首页
  ['home_featured_label', '精选'],
  ['home_latest_title', '最新文章'],
  ['home_all_posts_label', '全部 {count} 篇'],
  ['home_site_age_title', '站点运行时间'],
  // 文章页
  ['post_back_home', '返回首页'],
  ['post_updated_label', '更新于 {date}'],
  ['post_reading_label', '{minutes} 分钟阅读'],
  ['post_prev_label', '上一篇'],
  ['post_next_label', '下一篇'],
  ['post_related_title', '相关文章'],
  ['post_toc_title', '目录'],
  ['post_comments_title', '评论'],
  // 随笔页
  ['notes_eyebrow', 'Notes'],
  ['notes_page_title', '随笔'],
  ['notes_page_intro', '一些个人思考、日记和零碎的感悟。不成文章，随手记下。'],
  ['notes_time_title', '时间'],
  ['notes_empty_text', '还没有随笔，过些日子再来看看。'],
  ['notes_comments_title', '留言'],
  // 归档与分类标签页
  ['archive_eyebrow', 'Archive'],
  ['archive_page_title', '文章归档'],
  ['archive_intro_text', '目前收录 {count} 篇文章，可以按时间、分类或标签浏览。'],
  ['archive_categories_title', '分类'],
  ['archive_tags_title', '标签'],
  ['archive_empty_text', '这一页还没有文章。'],
  ['category_count_label', '这个分类下共有 {count} 篇文章。'],
  ['tag_count_label', '这个标签下共有 {count} 篇文章。'],
  // 标签墙
  ['tags_eyebrow', 'Tags'],
  ['tags_page_title', '标签墙'],
  ['tags_page_intro', '拾取标签，发现更多感兴趣的内容'],
  ['tags_count_label', '共 {count} 个标签'],
  ['tags_empty_text', '还没有标签。'],
  // 统计页
  ['stats_eyebrow', 'Statistics'],
  ['stats_page_title', '数据统计'],
  ['stats_page_intro', '博客网站的后台数据统计'],
  ['stats_card_posts', '文章统计'],
  ['stats_card_words', '字数统计'],
  ['stats_card_tags', '标签统计'],
  ['stats_card_notes', '随笔统计'],
  ['stats_categories_title', '分类一瞥'],
  ['stats_tagwall_title', '标签墙'],
  ['stats_years_title', '文章归档'],
  ['stats_empty_posts', '还没有文章。'],
  ['stats_empty_tags', '还没有标签。'],
  ['stats_empty_years', '还没有带日期的文章。'],
  ['stats_update_label', '最近更新于'],
  // 搜索页
  ['search_eyebrow', 'Search'],
  ['search_page_title', '搜索站内内容'],
  [
    'search_page_intro',
    '输入关键词，快速找到标题、摘要、分类或标签匹配的内容。日常搜索请用导航上的搜索按钮（/ 或 ⌘K）唤起的浮层，本页是浮层不可用时的兜底。',
  ],
  ['search_placeholder', 'Cursor、部署、Midjourney...'],
  ['search_button_label', '搜索'],
  // 404 页
  ['not_found_eyebrow', '404'],
  ['not_found_title', '页面不存在'],
  ['not_found_text', '这个链接可能已经移动、删除，或者地址输入有误。可以从下面几个入口继续浏览。'],
  ['not_found_home_label', '回到首页'],
  ['not_found_search_label', '搜索文章'],
  ['not_found_archive_label', '查看归档'],
  // 关于页补充
  ['about_eyebrow', 'ABOUT'],
  ['about_facts', '{count} 篇文章\n写于 {year} 至今\n全站由 AI 开发'],
  ['about_skills_title', '我的小本领'],
  ['about_note_link_label', '笔记'],
  // 页脚补充
  ['footer_credit', '由 Astro 构建'],
]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const [column, initial] of COPY_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS ${sql.identifier(column)} varchar;`)
    // 只填 NULL：列已存在（重复执行）或用户已改过的值一律不覆盖
    await db.execute(
      sql`UPDATE "site_settings" SET ${sql.identifier(column)} = COALESCE(${sql.identifier(column)}, ${initial});`,
    )
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const [column] of COPY_COLUMNS) {
    await db.execute(sql`ALTER TABLE "site_settings" DROP COLUMN IF EXISTS ${sql.identifier(column)};`)
  }
}
