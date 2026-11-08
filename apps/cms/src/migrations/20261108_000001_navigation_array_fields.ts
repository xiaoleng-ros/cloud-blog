import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：将 Navigation Global 从单 textarea 字段改为两个结构化数组。
 *
 * 背景：原来导航配置存在 navigation.nav_items（textarea，每行「文字 链接」），
 * 且「更多」面板完全硬编码在前台代码里。现在 Navigation.ts 定义了 topNav / morePanel
 * 两个 array 字段，Payload 需要对应的子表来存储。
 *
 * 操作：
 * 1. 删除旧的 nav_items 列（旧文本数据不迁移，用户在后台重新配置即可）
 * 2. 创建 navigation_top_nav 子表（顶部导航项）
 * 3. 创建 navigation_more_panel 子表（更多面板条目）
 * 4. 添加外键（_parent_id → navigation.id）和索引
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "navigation" DROP COLUMN IF EXISTS "nav_items";

    CREATE TABLE IF NOT EXISTS "navigation_top_nav" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "label" varchar NOT NULL,
      "href" varchar NOT NULL,
      "sort" numeric DEFAULT 0,
      "visible" boolean DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS "navigation_more_panel" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "label" varchar NOT NULL,
      "href" varchar NOT NULL,
      "icon" varchar,
      "external" boolean DEFAULT false,
      "sort" numeric DEFAULT 0,
      "visible" boolean DEFAULT true
    );

    ALTER TABLE "navigation_top_nav"
      ADD CONSTRAINT "navigation_top_nav_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation"("id")
      ON DELETE cascade ON UPDATE no action;

    ALTER TABLE "navigation_more_panel"
      ADD CONSTRAINT "navigation_more_panel_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation"("id")
      ON DELETE cascade ON UPDATE no action;

    CREATE INDEX IF NOT EXISTS "navigation_top_nav_order_idx" ON "navigation_top_nav" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "navigation_top_nav_parent_id_idx" ON "navigation_top_nav" USING btree ("_parent_id");
    CREATE INDEX IF NOT EXISTS "navigation_more_panel_order_idx" ON "navigation_more_panel" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "navigation_more_panel_parent_id_idx" ON "navigation_more_panel" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "navigation_more_panel" CASCADE;
    DROP TABLE IF EXISTS "navigation_top_nav" CASCADE;

    ALTER TABLE "navigation" ADD COLUMN IF NOT EXISTS "nav_items" varchar;
  `)
}
