/**
 * 渲染层输出回归校验。
 *
 * 背景：`src/lib/blog-render.tsx` 原本是 2192 行的单文件，按页面拆成
 * `src/lib/render/*` 十几个模块（见 docs/adr/0004-split-render-layer.md）。
 * 拆分是纯搬家，输出必须与拆分前逐字相同——这份脚本就是那条线。
 *
 * 它怎么跑：不启动 Next、不连数据库。`scripts/render-parity/loader.mjs` 把
 * `blog-sync` / `sync-cache` 换成可注入快照的桩，于是真实的渲染代码能在裸 Node 里
 * 直接执行（TypeScript 由 Node 22 的内置类型剥离处理）。
 *
 * 校验什么：45 个页面用例（15 路径 × 3 套快照）、6 个旧 URL 跳转用例、
 * 2 份站内搜索索引，全部与 `scripts/render-parity/baseline.json` 里的摘要比对。
 * 基线存摘要而非全量 HTML，是为了让 diff 能读——真要排查就让脚本打印当前输出。
 *
 * 改了渲染层、并且**确认输出变化是预期的**，用 `node scripts/verify-render-parity.mjs --update`
 * 重算基线，并把变更理由写进提交信息。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(HERE, 'render-parity', 'baseline.json')

// ---------------------------------------------------------------------------
// 冻结渲染期的所有环境输入
//
// 这份基线的意义是「同一份代码永远算出同一份 HTML」。任何从外部读进来的东西
// 都会让它在不同机器上失配，而失配时人是分不清「我改坏了」还是「环境不同」的。
// 三个来源都踩过：
//
// 1. NEXT_PUBLIC_SERVER_URL —— `src/lib/render/config.ts:13` 在**模块加载时**就把它
//    读进 SITE_DEFAULTS.url，而 renderArticleLicense 用它拼文章绝对地址。
//    本地没这个变量（取 example.com），EdgeOne 构建机有（取真实域名），
//    于是 articleFooter 区块的摘要必然不同。首次部署就是这么失败的。
// 2. NODE_ENV —— `src/lib/render/site-settings.ts:111` 的 avatarOf 在 production
//    下返回构建期小图、否则回退后台原图，两条分支输出不同。
// 3. 当前时间 —— `src/lib/render/util.ts:28` 的 currentYearShanghai 喂给页脚年份，
//    不冻结的话每年 1 月 1 日基线都会「莫名」失效。
//
// 冻结的是**测试的输入**，不是被测行为：渲染代码本身没被改动，换任何 URL
// 它仍然会拼出对应的绝对地址。
// ---------------------------------------------------------------------------
process.env.NEXT_PUBLIC_SERVER_URL = 'https://example.com'
process.env.NODE_ENV = 'test'

const FIXED_NOW = new Date('2026-06-01T12:00:00+08:00').getTime()
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW)
    else super(...args)
  }
  static now() {
    return FIXED_NOW
  }
}

register('./render-parity/loader.mjs', import.meta.url)

const { runCases } = await import('./render-parity/cases.mjs')
const mod = await import('../src/lib/blog-render.tsx')

const digest = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)

/** 把一次完整渲染压成可比的摘要树 */
function summarize({ cases, legacy, index, indexEmpty }) {
  return {
    cases: cases.map((item) =>
      item.ok
        ? {
            label: item.label,
            path: item.path,
            title: item.title,
            notFound: item.notFound,
            runtime: item.runtime,
            blocks: Object.fromEntries(Object.entries(item.blocks).map(([k, v]) => [k, digest(v)])),
          }
        : { label: item.label, path: item.path, error: item.error },
    ),
    legacy,
    index: digest(JSON.stringify(index)),
    indexCount: index.length,
    indexEmpty: digest(JSON.stringify(indexEmpty)),
    indexEmptyCount: indexEmpty.length,
  }
}

const actual = summarize(await runCases(mod))

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + '\n')
  console.log(`[render] 基线已更新：${actual.cases.length} 个用例，索引 ${actual.indexCount} 条`)
  process.exit(0)
}

let expected
try {
  expected = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error(`[render] 读不到基线 ${BASELINE}，先跑一次 --update`)
  process.exit(2)
}

const problems = []
for (let i = 0; i < Math.max(expected.cases.length, actual.cases.length); i++) {
  const want = expected.cases[i]
  const got = actual.cases[i]
  if (!want || !got || want.path !== got.path || want.label !== got.label) {
    problems.push(`${got?.label ?? want?.label} ${got?.path ?? want?.path}：用例集合与基线不符`)
    continue
  }
  const where = `${got.label} ${got.path}`
  if (want.error || got.error) {
    if (want.error !== got.error)
      problems.push(`${where}：抛错情况变了（${want.error ?? '无'} → ${got.error ?? '无'}）`)
    continue
  }
  if (want.title !== got.title) problems.push(`${where}：title 变了`)
  if (want.notFound !== got.notFound) problems.push(`${where}：notFound 变了`)
  if (JSON.stringify(want.runtime) !== JSON.stringify(got.runtime)) problems.push(`${where}：runtime 变了`)
  const keys = new Set([...Object.keys(want.blocks), ...Object.keys(got.blocks)])
  for (const key of keys) {
    if (want.blocks[key] !== got.blocks[key]) {
      const now = got.blocks[key] === undefined ? '区块消失' : `当前 ${got.blocks[key]}`
      problems.push(`${where}：区块 ${key} 输出变了（基线 ${want.blocks[key] ?? '不存在'}，${now}）`)
    }
  }
}

const legacyDiff = JSON.stringify(expected.legacy) !== JSON.stringify(actual.legacy)
if (legacyDiff) problems.push('旧 URL 跳转结果变了')
if (expected.index !== actual.index) problems.push('站内搜索索引变了')
if (expected.indexEmpty !== actual.indexEmpty) problems.push('空站内搜索索引变了')

if (problems.length) {
  console.error(`[render] 渲染输出与基线不符，${problems.length} 处：`)
  for (const line of problems.slice(0, 40)) console.error(`  - ${line}`)
  if (problems.length > 40) console.error(`  …另有 ${problems.length - 40} 处`)
  console.error('[render] 若变化是预期的，跑 --update 重算基线并在提交信息里写清原因')
  process.exit(1)
}

console.log(
  `[render] 通过：${actual.cases.length} 个页面用例、${actual.legacy.length} 个跳转用例、` +
    `索引 ${actual.indexCount} 条，输出与基线逐字相同`,
)
