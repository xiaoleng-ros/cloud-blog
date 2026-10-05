import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除 site_settings 的「评论服务地址」列。
 *
 * 背景：评论地址改由前台环境变量 PUBLIC_WALINE_URL 决定（同域默认 /api/waline），
 * 后台不再维护该字段。列从未被博客端消费，本地/线上均为空；twikoo_env_id 是更早的
 * 旧名（同字段），一并兜底删除，让各环境收敛到同一 schema（旧改名迁移从未部署）。
 *
 * 幂等：全部 DROP COLUMN IF EXISTS，重复执行安全。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "waline_url";
    ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "twikoo_env_id";
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "waline_url" varchar;
  `)
}
