import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：移除 categories 表的「节点类型」字段，删除 page/nav 类型的分类。
 *
 * 背景：分类管理原本支持三种节点类型（category/page/nav），但 page/nav 是历史层级标记，
 * 前台从未消费，且容易让用户误以为可以通过分类管理配置导航。现已将「页面/导航」能力迁移到
 * 「导航管理」Global（见 globals/Navigation.ts），分类集合只负责文章归档层级。
 *
 * 操作顺序：
 * 1. 先把 node_type 为 page/nav 的分类行删掉（这些行没有任何前台消费，留着也无用）
 * 2. 再 DROP COLUMN node_type
 * 3. 最后 DROP TYPE enum_categories_node_type（必须在列删掉之后）
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DELETE FROM "categories" WHERE "node_type" IN ('page', 'nav');

    ALTER TABLE "categories" DROP COLUMN IF EXISTS "node_type";

    DROP TYPE IF EXISTS "enum_categories_node_type";
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_categories_node_type" AS ENUM ('category', 'page', 'nav');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "node_type" "enum_categories_node_type" NOT NULL DEFAULT 'category';
  `)
}
