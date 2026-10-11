/**
 * 连接链路诊断（只读，不写任何数据）：从本机探测 Supabase 的连通性。
 * 用途：区分「数据库侧问题」还是「EdgeOne 函数侧问题」。
 * 用法（仓库根目录）：node apps/cms/scripts/db-ping.mjs
 */
import fs from 'node:fs'
import net from 'node:net'
import dns from 'node:dns'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(here, '../../.env.supabase')
const envTxt = fs.readFileSync(envPath, 'utf8')
const line = envTxt.split(/\r?\n/).find((l) => l.startsWith('POSTGRES_URL='))
if (!line) throw new Error('.env.supabase 里找不到 POSTGRES_URL')

const parsed = new URL(line.slice('POSTGRES_URL='.length).trim())
const host = parsed.hostname
const port = Number(parsed.port || 5432)
const user = parsed.username
const pass = parsed.password
const dbName = parsed.pathname.replace(/^\//, '') || 'postgres'
const ref = user.includes('.') ? user.split('.').pop() : null
const conn = `postgresql://${user}:${pass}@${host}:${port}/${dbName}`

console.log('[target] pooler:', `${host}:${port}`, '| direct:', ref ? `db.${ref}.supabase.co` : '(unknown)')

async function dnsProbe(h) {
  const t0 = Date.now()
  try {
    const addrs = await dns.promises.lookup(h, { all: true })
    console.log(`[dns] ${h} OK ${Date.now() - t0}ms`, addrs.map((a) => `${a.address} v${a.family}`).join(', '))
  } catch (e) {
    console.log(`[dns] ${h} FAIL ${Date.now() - t0}ms`, e.code || e.message)
  }
}

function tcpProbe(h, p) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const sock = net.connect({ host: h, port: p })
    const fin = (tag, msg) => {
      sock.destroy()
      console.log(`[tcp] ${h}:${p} ${tag} ${Date.now() - t0}ms`, msg ?? '')
      resolve()
    }
    sock.setTimeout(8000)
    sock.on('connect', () => fin('OK'))
    sock.on('timeout', () => fin('TIMEOUT'))
    sock.on('error', (e) => fin('FAIL', e.code || e.message))
  })
}

async function pgProbe(mode) {
  const t0 = Date.now()
  const client = new pg.Client({
    connectionString: conn,
    ssl: mode === 'strict' ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  try {
    await client.connect()
    const q1 = await client.query('select count(*)::int as total from pg_stat_activity')
    const q2 = await client.query(
      "select coalesce(state, '?') as state, count(*)::int as n from pg_stat_activity group by 1 order by 2 desc",
    )
    console.log(`[pg-${mode}] OK ${Date.now() - t0}ms`, '连接总数', q1.rows[0].total, JSON.stringify(q2.rows))
    await client.end()
  } catch (e) {
    try {
      await client.end()
    } catch {}
    console.log(`[pg-${mode}] FAIL ${Date.now() - t0}ms`, e.message)
  }
}

await dnsProbe(host)
if (ref) await dnsProbe(`db.${ref}.supabase.co`)
await tcpProbe(host, port)
if (ref) await tcpProbe(`db.${ref}.supabase.co`, 5432)
await pgProbe('strict')
await pgProbe('relaxed')
console.log('[done] 把以上完整输出发给助手')
