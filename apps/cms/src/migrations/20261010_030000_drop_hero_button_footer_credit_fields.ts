import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除「站点设置」中的两个字段（按用户要求整栏删除，前台回退为写死）。
 *
 *  - button_label  首页 Hero「浏览文章按钮文字」→ 前台固定「浏览文章」
 *    （index.astro 与 blog-render.tsx 两侧同步回退，按钮本身保留）
 *  - footer_credit 页脚「底栏声明文字」→ 前台只留版权行「© 年 作者」，声明段不再渲染
 *    （Footer.astro 与 blog-render.renderFooterBar 同步回退；PageCopy 键一并删除）
 *
 * button_label 由 20260910_061332_init 引入（后转 varchar），footer_credit 由
 * 20261009_000000_add_page_copy_fields 引入；此处直接 DROP。
 */
const DROPPED_COLUMNS = ['button_label', 'footer_credit'] as const

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
