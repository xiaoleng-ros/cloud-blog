import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：删除 posts.slug，为 posts/notes 增加 categories 单选必填关系。
 *
 * Payload 中「单选 relationship」的列直接存在主表（posts/notes），
 * 不是 xxx_rels 中间表——只有 hasMany 关系才走 rels 表。
 *
 * up 阶段：
 *   1) 删除 posts.slug 索引与列
 *   2) posts 主表新增 categories_id（NOT NULL，先落第一分类作为兜底值再收紧约束）
 *   3) notes 主表新增 categories_id（同上）
 *   4) 清理旧 schema 遗留：posts_rels / notes_rels 上的 categories_id 已不需要
 *
 * 说明：categories 列为 NOT NULL，且现有帖子已存在。
 *       若直接 ALTER TABLE ADD COLUMN ... NOT NULL 会因现存行缺值而失败。
 *       因此策略是：先可空 ADD → 用子查询回填第一分类 → 再 SET NOT NULL。
 *       回填子查询依赖 categories 表至少有一行数据；调用前先跑 import:data 脚本即可保证。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    -- 1) 删除 posts.slug 相关索引与列（顺序不能反：先删索引再删列）
    DROP INDEX IF EXISTS "posts_slug_idx";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "slug";

    -- 2) posts 主表新增 categories_id
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "categories_id" integer;
    -- 用子查询回填：每行取 categories 表中 id 最小的一行作为默认分类
    UPDATE "posts"
       SET "categories_id" = (SELECT MIN("id") FROM "categories")
     WHERE "categories_id" IS NULL;
    -- 收紧为 NOT NULL（此时所有行都应有值；若 categories 表为空，此行会失败并抛出可读错误）
    ALTER TABLE "posts" ALTER COLUMN "categories_id" SET NOT NULL;
    CREATE INDEX IF NOT EXISTS "posts_categories_idx" ON "posts" USING btree ("categories_id");
    ALTER TABLE "posts" ADD CONSTRAINT "posts_categories_fk"
      FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id")
      ON DELETE set null ON UPDATE no action;

    -- 3) notes 主表新增 categories_id
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "categories_id" integer;
    UPDATE "notes"
       SET "categories_id" = (SELECT MIN("id") FROM "categories")
     WHERE "categories_id" IS NULL;
    ALTER TABLE "notes" ALTER COLUMN "categories_id" SET NOT NULL;
    CREATE INDEX IF NOT EXISTS "notes_categories_idx" ON "notes" USING btree ("categories_id");
    ALTER TABLE "notes" ADD CONSTRAINT "notes_categories_fk"
      FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id")
      ON DELETE set null ON UPDATE no action;

    -- 4) 清理旧 schema 遗留：posts_rels / notes_rels 上的 categories_id 已不需要
    ALTER TABLE "posts_rels" DROP CONSTRAINT IF EXISTS "posts_rels_categories_fk";
    DROP INDEX IF EXISTS "posts_rels_categories_id_idx";
    ALTER TABLE "posts_rels" DROP COLUMN IF EXISTS "categories_id";

    ALTER TABLE "notes_rels" DROP CONSTRAINT IF EXISTS "notes_rels_categories_fk";
    DROP INDEX IF EXISTS "notes_rels_categories_id_idx";
    ALTER TABLE "notes_rels" DROP COLUMN IF EXISTS "categories_id";
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    -- 反向回滚：移除 posts/notes 主表上的 categories_id
    ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_categories_fk";
    DROP INDEX IF EXISTS "posts_categories_idx";
    ALTER TABLE "posts" DROP COLUMN IF EXISTS "categories_id";

    ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_categories_fk";
    DROP INDEX IF EXISTS "notes_categories_idx";
    ALTER TABLE "notes" DROP COLUMN IF EXISTS "categories_id";

    -- 恢复 posts.slug 列。迁移时没有保留原 slug 值，此处仅恢复「可写」形态（非 NOT NULL），
    -- 用部分唯一索引保证非空值仍唯一，避免多个空字符串冲突。
    ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "slug" varchar;
    CREATE UNIQUE INDEX IF NOT EXISTS "posts_slug_idx" ON "posts" USING btree ("slug") WHERE "slug" IS NOT NULL;
  `)
}
