import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：补齐 Payload 3.91 新增的两个核心列。
 *
 * 背景（2026-10-18 依赖升级 3.88.0 → 3.91.0）：
 *   - 上传集合（Media）在 3.91 起多出内部列 `_objectkey`（注意：列名**没有**第二个下划线，是 Payload 把字段名 `_objectKey` 转成库列名后的结果，实测查询语句里就是 "_objectkey"，写成 _object_key 会继续报 column does not exist）（记录存储对象键，
 *     给 S3/云存储适配器用；本地磁盘存储时为空）。
 *   - 认证集合（Users）多出 `reset_password_requested_at`（忘记密码请求时间戳，
 *     用于限频）。
 *
 * 缺列的后果不是「少个字段」，而是查询直接 500：
 *   Payload 的 select 会带上这两列，Postgres 回 `column ... does not exist`。
 *   实测升级后 /api/media 与 /api/users 均返回 500，补列后恢复。
 *   （posts/notes/projects 等业务集合不受影响，因为它们没有这两个字段。）
 *
 * 类型对齐：时间列统一 `timestamp(3) with time zone`，与既有 created_at/updated_at
 * 以及 Payload drizzle schema 的产出保持一致；`_object_key` 为 varchar，可空。
 *
 * 幂等：全部 ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS，重复执行安全。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "_objectkey" varchar;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "media" DROP COLUMN IF EXISTS "_objectkey";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_requested_at";
  `)
}
