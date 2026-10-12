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
// here = apps/cms/scripts，所以 ../ 即 apps/cms（.env.supabase 所在目录）。
// 此前写成 '../../' 只回到 apps/，导致无论从哪个 cwd 运行都 ENOENT ——
// 而这正是排查线上 Payload 连接故障时最该先用的脚本，等于关键时刻失灵。
const envPath = path.resolve(here, '../.env.supabase')
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

/**
 * Supabase CA 证书（严格模式必需）。
 *
 * 与 payload.config.ts 的 loadSupabaseCa() 同源同路径探测规则：
 * 不带 CA 的 strict 探测在 EdgeOne 那种「容器信任库无 Supabase 根证书」的环境里
 * 必然失败，会把「证书缺失」误报成「数据库连不上」。带上 CA 后 strict/relaxed
 * 的差异才真正反映「要不要校验证书」这一个变量。
 */
const CA_RELATIVE = 'certs/supabase-ca.pem'
const caPath = [
  path.resolve(here, '..', CA_RELATIVE),
  path.resolve(process.cwd(), CA_RELATIVE),
  path.resolve(process.cwd(), 'apps', 'cms', CA_RELATIVE),
].find((p) => {
  try {
    // 必须走 fs.readFileSync：本文件是 `import fs from 'node:fs'` 默认导入，
    // 没有裸 readFileSync 绑定。误用裸名会被下面 catch 静默吞成「没找到证书」，
    // 于是 strict 永远失败 —— 与未修之前表现完全一样，极难察觉。
    return fs.readFileSync(p, 'utf-8').includes('BEGIN CERTIFICATE')
  } catch {
    return false
  }
})

const pgCa = caPath ? fs.readFileSync(caPath, 'utf-8') : undefined

if (!pgCa) {
  console.warn(
    `[ca] 未找到 ${CA_RELATIVE}，strict 探测会因缺 CA 而失败（这不代表数据库不可用）。`,
  )
}

async function pgProbe(mode) {
  const t0 = Date.now()
  const client = new pg.Client({
    connectionString: conn,
    ssl:
      mode === 'strict'
        ? { rejectUnauthorized: true, ...(pgCa ? { ca: pgCa } : {}) }
        : { rejectUnauthorized: false },
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
