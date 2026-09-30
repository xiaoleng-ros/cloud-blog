import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：为 categories 表补上「树形分类」四列（节点类型 / 上级分类 / 排序权重 / 前台可见）。
 *
 * 背景：分类管理页改造成树形 + 弹窗 CRUD（见 Collections/Categories.ts 与
 * admin/views/categories/*）。列名与 DDL 与 payload generate:db-schema 输出一致：
 * node_type 是 PG enum（Payload select 的落库形态），parent_id 自关联 FK（SET NULL），
 * 且 schema 声明了 categories_parent_idx 索引，迁移必须一并创建，否则 push 判定漂移。
 *
 * 存量行：ADD COLUMN ... DEFAULT 会让 PG 直接回填默认值
 * （node_type='category'、sort=0、visible=true），旧数据全部按「可见的顶层分类」处理。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_categories_node_type" AS ENUM ('category', 'page', 'nav');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "node_type" "enum_categories_node_type" NOT NULL DEFAULT 'category';
    ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parent_id" integer;
    ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sort" numeric DEFAULT 0;
    ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "visible" boolean DEFAULT true;

    DO $$ BEGIN
      ALTER TABLE "categories"
        ADD CONSTRAINT "categories_parent_id_categories_id_fk"
        FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE INDEX IF NOT EXISTS "categories_parent_idx"
      ON "categories" USING btree ("parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "categories_parent_idx";
    ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_parent_id_categories_id_fk";
    ALTER TABLE "categories" DROP COLUMN IF EXISTS "parent_id";
    ALTER TABLE "categories" DROP COLUMN IF EXISTS "node_type";
    ALTER TABLE "categories" DROP COLUMN IF EXISTS "sort";
    ALTER TABLE "categories" DROP COLUMN IF EXISTS "visible";
    DROP TYPE IF EXISTS "enum_categories_node_type";
  `)
}
