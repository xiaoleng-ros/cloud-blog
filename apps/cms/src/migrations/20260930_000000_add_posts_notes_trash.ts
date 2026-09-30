import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：为 posts / notes 表补上回收站软删除列。
 *
 * 背景：两集合开启内置 `trash: true` 后 Payload 会写入 deletedAt 标记列，
 * 生产库不做 schema push，必须靠本迁移补列，否则删除/回收站查询报「列不存在」。
 *
 * 列名 / 类型与 payload generate:db-schema 输出一致：
 * timestamp(3) with time zone 可空列 + 等值过滤用的普通 btree 索引。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp(3) with time zone;
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp(3) with time zone;

    CREATE INDEX IF NOT EXISTS "posts_deleted_at_idx"
      ON "posts" USING btree ("deleted_at");
    CREATE INDEX IF NOT EXISTS "notes_deleted_at_idx"
      ON "notes" USING btree ("deleted_at");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "posts_deleted_at_idx";
    DROP INDEX IF EXISTS "notes_deleted_at_idx";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "deleted_at";
    ALTER TABLE "notes" DROP COLUMN IF EXISTS "deleted_at";
  `)
}
