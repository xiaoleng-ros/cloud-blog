import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 随笔（notes）新增「摘要」(description) 字段。
 *
 * 背景：发布/存草稿弹窗需要像文章一样填写摘要，并支持一键让模型总结全文生成摘要。
 * 纯加列，不动任何既有数据；已有行该列为 NULL，前台按「留空不展示」处理。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "description" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "notes" DROP COLUMN IF EXISTS "description";`)
}
