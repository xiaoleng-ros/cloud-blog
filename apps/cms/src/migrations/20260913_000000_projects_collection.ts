import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_projects_status" AS ENUM('draft', 'published');
  CREATE TABLE "projects" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"group" varchar NOT NULL,
  	"group_description" varchar,
  	"title" varchar NOT NULL,
  	"owner" varchar,
  	"description" varchar,
  	"icon" varchar,
  	"href" varchar,
  	"article_href" varchar,
  	"stars" numeric,
  	"tags" varchar,
  	"sort_order" numeric,
  	"status" "enum_projects_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX "projects_group_idx" ON "projects" ("group");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "projects";
  DROP TYPE "public"."enum_projects_status";`)
}
