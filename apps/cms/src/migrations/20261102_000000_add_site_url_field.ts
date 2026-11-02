import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 站点设置新增「站点网址」(site_url)。
 *
 * 背景：友链页「我的博客信息」需要展示**对外**的正式地址，
 * 而此前只能读构建环境的 SITE_URL —— 本地开发下它是 http://localhost:3000，
 * 拿去交换友链毫无意义。这个字段让地址变成后台可维护的数据。
 *
 * 纯加列，不动任何既有数据；已有行该列为 NULL，前台按「留空回退 env」处理。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "site_url" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "site_url";`)
}
