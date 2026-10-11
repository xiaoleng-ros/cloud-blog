/**
 * 一次性脚本：对线上 Supabase 执行 Waline 建表 SQL（同目录 schema.sql）。
 * 连接串从仓库内 apps/cms/.env.supabase 的 POSTGRES_URL 读取（不打印凭据）。
 * 幂等保护：public 下已存在 wl_* 表时跳过建表；末尾只读列出 media 表现状。
 * 用法（仓库根目录）：node apps/cms/scripts/waline/setup-prod.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(here, '../../.env.supabase')
const sqlPath = path.resolve(here, 'schema.sql')

async function main() {
  const envTxt = fs.readFileSync(envPath, 'utf8')
  const line = envTxt.split(/\r?\n/).find((l) => l.startsWith('POSTGRES_URL='))
  if (!line) throw new Error('.env.supabase 里找不到 POSTGRES_URL')
  const url = line.slice('POSTGRES_URL='.length).trim().split('?')[0]

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
  })
  await client.connect()
  try {
    const conn = await client.query('select current_database() db, current_user u')
    console.log('[connected]', conn.rows[0])

    const before = await client.query(
      "select tablename from pg_tables where schemaname='public' and left(tablename,3)='wl_' order by 1",
    )
    console.log('[before] wl_ tables:', before.rows.map((r) => r.tablename).join(', ') || '(none)')

    if (before.rowCount === 0) {
      await client.query(fs.readFileSync(sqlPath, 'utf8'))
      const after = await client.query(
        "select tablename from pg_tables where schemaname='public' and left(tablename,3)='wl_' order by 1",
      )
      console.log('[exec] schema.sql 执行完成')
      console.log('[after ] wl_ tables:', after.rows.map((r) => r.tablename).join(', '))
    } else {
      console.log('[exec] wl_ 表已存在，跳过建表')
    }

    const media = await client.query('select id, filename, url from media order by id')
    console.log('[media rows]', media.rowCount)
    for (const r of media.rows) console.log('  ', r.id, '|', r.filename, '|', r.url)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('[FATAL]', e.message)
  process.exit(1)
})
