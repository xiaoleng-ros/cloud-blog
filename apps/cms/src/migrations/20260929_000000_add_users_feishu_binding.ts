import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：为 users 表补上「飞书扫码登录」绑定列。
 *
 * 背景：Collections/Users.ts 新增 feishu group（openId / unionId / name / avatar）后
 * 没有生成迁移，而 push 默认关闭（见 payload.config.ts），线上库缺列 →
 * 回调里 `where: { 'feishu.openId': ... }` 直接报「列不存在」，飞书登录整条链路不可用。
 *
 * 列名与 payload generate:db-schema 的输出一致（group 字段拍平为 feishu_<name>）。
 * 四列均可空：未绑定的账号保持 null，登录时一律拒绝（不做自动绑定）。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "feishu_open_id" varchar;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "feishu_union_id" varchar;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "feishu_name" varchar;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "feishu_avatar" varchar;

    -- open_id 是登录查找键（每次回调都做等值查询），补普通索引。
    -- 刻意不做唯一索引：字段本身未声明 unique，加索引会让后续 migrate:create 判定为 schema 漂移。
    -- 「一个 open_id 只能绑一个账号」由 /api/feishu/bind 的 count 校验保证。
    CREATE INDEX IF NOT EXISTS "users_feishu_open_id_idx"
      ON "users" USING btree ("feishu_open_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "users_feishu_open_id_idx";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "feishu_open_id";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "feishu_union_id";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "feishu_name";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "feishu_avatar";
  `)
}
