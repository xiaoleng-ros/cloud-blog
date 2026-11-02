import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 新增 friends 集合（友链）。
 *
 * 只做加法：建新表 + 在 payload_locked_documents_rels 补一列外键，
 * 不改动任何既有表结构，对线上数据零影响。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_friends_status" AS ENUM('pending', 'published', 'rejected', 'hidden');
  CREATE TYPE "public"."enum_friends_source" AS ENUM('manual', 'apply');
  CREATE TABLE "friends" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"url" varchar NOT NULL,
  	"description" varchar,
  	"avatar" varchar,
  	"group" varchar DEFAULT '朋友们' NOT NULL,
  	"group_description" varchar,
  	"note" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"status" "enum_friends_status" DEFAULT 'pending' NOT NULL,
  	"source" "enum_friends_source" DEFAULT 'manual' NOT NULL,
  	"email" varchar,
  	"message" varchar,
  	"submit_ip" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "friends_url_idx" ON "friends" ("url");
  CREATE INDEX "friends_group_idx" ON "friends" ("group");
  CREATE INDEX "friends_sort_order_idx" ON "friends" ("sort_order");
  CREATE INDEX "friends_status_idx" ON "friends" ("status");
  CREATE INDEX "friends_updated_at_idx" ON "friends" USING btree ("updated_at");
  CREATE INDEX "friends_created_at_idx" ON "friends" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "friends_id" integer;
  CREATE INDEX "payload_locked_documents_rels_friends_id_idx" ON "payload_locked_documents_rels" ("friends_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_friends_fk" FOREIGN KEY ("friends_id") REFERENCES "friends"("id") ON DELETE cascade;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_friends_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_friends_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "friends_id";
  DROP TABLE "friends";
  DROP TYPE "public"."enum_friends_status";
  DROP TYPE "public"."enum_friends_source";`)
}
