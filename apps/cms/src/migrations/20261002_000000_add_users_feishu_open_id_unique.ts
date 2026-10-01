import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 迁移：给 users.feishu_open_id 补「部分唯一索引」，封死两个账号绑定同一 open_id 的并发窗口。
 *
 * 背景：/api/feishu/bind 的「count 查重 → update 写入」不是原子操作，
 * 两个已登录账号并发提交同一个 open_id 时都能通过 count 校验，互相成为提权入口
 * （20260929 迁移刻意不做唯一索引、把约束交给应用层校验，正是这里的缺口）。
 *
 * 为什么是 partial（WHERE col IS NOT NULL AND col <> ''）：
 *  - 未绑定账号该列为 NULL，多个 NULL 本身不冲突；
 *  - 但 Payload 后台手工清空字段可能落库为空串 ''，多个 '' 会互相撞唯一约束，
 *    必须连同 '' 一起排除出唯一性范围。
 *
 * 为什么只加迁移、不在 Users.ts 给字段声明 unique: true：
 *  - Payload 的 unique 生成的是整列 UNIQUE 索引（无法带 WHERE 排除 ''），
 *    与这里的 partial 定义必然漂移，后续 generate:migrations / push 会反复报 schema 不一致，
 *    且 '' 多行场景会直接让线上写入失败；
 *  - 唯一约束冲突由 bind 路由捕获（PG 23505）转成 400 友好提示。
 *
 * 注意：up 之前若库里已存在同值重复绑定，CREATE UNIQUE INDEX 会失败并阻止启动 ——
 * 这是有意的（重复绑定本身就是待处理的安全事故），需先人工清理再部署。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "users_feishu_open_id_uniq"
      ON "users" USING btree ("feishu_open_id")
      WHERE "feishu_open_id" IS NOT NULL AND "feishu_open_id" <> '';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "users_feishu_open_id_uniq";
  `)
}
