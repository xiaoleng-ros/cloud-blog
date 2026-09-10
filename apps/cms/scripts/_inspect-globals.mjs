import { createClient } from '@libsql/client'

const client = createClient({ url: 'file:payload.db' })
const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
)
console.log('TABLES:', tables.rows.map((r) => r.name).join(', '))

// 找到可能是 navItems 数据的表，列出内容
const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table'")
for (const { name } of result.rows) {
  if (/nav/i.test(String(name)) || /global/i.test(String(name)) || /_array/i.test(String(name))) {
    console.log('\n== ' + name + ' ==')
    const cols = await client.execute(`PRAGMA table_info("${name}")`)
    console.log('cols:', cols.rows.map((c) => c.name).join(', '))
    const data = await client.execute(`SELECT * FROM "${name}" LIMIT 20`)
    for (const row of data.rows) {
      console.log(JSON.stringify(row).slice(0, 600))
    }
  }
}