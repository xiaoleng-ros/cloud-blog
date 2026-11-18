import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 新增 AI 模型配置 global（ai-models）。
 *
 * 用一张单例表存放 providers 数组（供应商 / API Key / 模型列表），列类型为 jsonb。
 * Payload global 只有一个 providers 字段，故表只有 id + providers + 时间戳。
 * 纯加表，不动任何既有数据。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_models" (
      "id" serial PRIMARY KEY NOT NULL,
      "providers" jsonb DEFAULT '[]'::jsonb,
      "updated_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone
    );`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "ai_models" CASCADE;`)
}
