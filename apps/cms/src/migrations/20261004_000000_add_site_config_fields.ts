import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：为 site_settings 表补上「网站配置」三列（图标 / ICP 备案号 / 创建时间）。
 *
 * 背景：站点设置新增「网站配置」分区（见 globals/SiteSettings.ts 与
 * admin/views/settings/SettingsEditView.tsx）。列名与 globals/site_settings 的
 * snake_case 落库形态一致，全部可空——本轮只入库，前台暂不消费。
 *
 * site_created_at 存 'YYYY-MM-DD' 文本而非 timestamp：date 字段跨时区读回会整体偏一天。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "site_icon" varchar;
    ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "site_icp" varchar;
    ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "site_created_at" varchar;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "site_created_at";
    ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "site_icp";
    ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "site_icon";
  `)
}
