#!/usr/bin/env node
/**
 * CSP 策略一致性校验。
 *
 * 为什么需要这个脚本：同一份 CSP 必须在两处下发，而这两处没法共享代码——
 *   1. `apps/cms/next.config.mjs` 的 `headers()`：走 Node 函数的响应
 *      （`/admin`、`/api/*`、以及没被静态化命中的页面）；
 *   2. `apps/cms/edgeone.json` 的 `headers`：静态层直接吐出的文件
 *      （静态化后的 `public/<path>/index.html`、`/_astro/*`），**根本不经过 Next**，
 *      next.config 里的头对它无效。
 * 只改一处的话，一部分页面有 CSP、一部分没有，而"没有"这件事在浏览器里完全没有
 * 报错——只有把两处取出来逐字比对才能发现。所以放进构建链和 CI。
 *
 * 顺带校验 `frame-src` 与 `shared/md-sanitize-schema.mjs` 的 `MD_IFRAME_HOSTS` 一致：
 * 净化器放行某 host 的 iframe、CSP 却不放行，结果是"内容审核通过但浏览器拦掉"，
 * 这种不一致极难从现象反推原因。
 *
 * 用法：node scripts/verify-csp-sync.mjs   （退出码 0 通过 / 1 失败）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CSP_HEADER_NAME, CSP_POLICY, FRAME_HOSTS } from '../csp-policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CMS_ROOT = join(HERE, '..')
const REPO_ROOT = join(CMS_ROOT, '..', '..')

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

// ── 1. edgeone.json 里的取值必须与 csp-policy.mjs 完全一致 ──────────────────
const edgeone = JSON.parse(readFileSync(join(CMS_ROOT, 'edgeone.json'), 'utf8'))
const edgeRules = (edgeone.headers ?? []).flatMap((rule) =>
  (rule.headers ?? []).filter((h) => h.key === CSP_HEADER_NAME).map((h) => ({ source: rule.source, value: h.value })),
)

check(edgeRules.length > 0, `edgeone.json 里没有任何 ${CSP_HEADER_NAME} 头（静态层会裸奔）`)
check(edgeRules.length <= 1, `edgeone.json 里 ${CSP_HEADER_NAME} 声明了 ${edgeRules.length} 次，应合并为一条 /* 规则`)

for (const rule of edgeRules) {
  if (rule.value !== CSP_POLICY) {
    failures.push(
      `edgeone.json 的 ${CSP_HEADER_NAME}（source=${rule.source}）与 csp-policy.mjs 不一致\n` +
        `  edgeone.json : ${rule.value}\n` +
        `  csp-policy   : ${CSP_POLICY}`,
    )
  }
}

// ── 2. next.config.mjs 必须从 csp-policy.mjs 取，而不是手写字符串 ─────────────
const nextConfig = readFileSync(join(CMS_ROOT, 'next.config.mjs'), 'utf8')
check(
  nextConfig.includes('csp-policy.mjs'),
  'next.config.mjs 没有 import ./csp-policy.mjs —— 头必须来自唯一来源，不能手写第二份',
)
check(nextConfig.includes('CSP_POLICY'), 'next.config.mjs 引了 csp-policy.mjs 但没用到 CSP_POLICY')
check(
  !/value:\s*['"]default-src/.test(nextConfig),
  'next.config.mjs 里出现了手写的 CSP 字符串字面量，应从 csp-policy.mjs 引入',
)

// ── 3. frame-src 必须覆盖净化器的 iframe 白名单 ──────────────────────────────
const frameSrc = CSP_POLICY.split(';')
  .map((part) => part.trim())
  .find((part) => part.startsWith('frame-src'))

check(Boolean(frameSrc), 'CSP_POLICY 里没有 frame-src 指令')

if (frameSrc) {
  const allowed = frameSrc.replace(/^frame-src\s+/, '').split(/\s+/)
  const sanitizeSchema = readFileSync(join(REPO_ROOT, 'shared', 'md-sanitize-schema.mjs'), 'utf8')
  const block = sanitizeSchema.match(/MD_IFRAME_HOSTS\s*=\s*\[([\s\S]*?)\]/)
  check(Boolean(block), 'shared/md-sanitize-schema.mjs 里找不到 MD_IFRAME_HOSTS')

  if (block) {
    const schemaHosts = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    check(schemaHosts.length > 0, 'MD_IFRAME_HOSTS 解析出 0 个 host，正则可能已失效（请检查该文件格式）')
    for (const host of schemaHosts) {
      if (!allowed.includes(`https://${host}`)) {
        failures.push(
          `净化器放行 ${host} 的 iframe，但 CSP frame-src 没有 https://${host} —— ` + `结果会是"审核通过、浏览器拦掉"`,
        )
      }
    }
    // 反向：CSP 里有、净化器没有，属无害冗余，但要提示，避免两边越飘越远
    const extra = allowed.filter((a) => a.startsWith('https://') && !schemaHosts.includes(a.slice(8)))
    if (extra.length > 0) {
      console.warn(`[csp] 提示：frame-src 比 MD_IFRAME_HOSTS 多出 ${extra.join(', ')}（不报错，但两侧已开始漂移）`)
    }
    check(
      JSON.stringify([...FRAME_HOSTS].sort()) === JSON.stringify([...schemaHosts.map((h) => `https://${h}`)].sort()),
      'csp-policy.mjs 的 FRAME_HOSTS 与 MD_IFRAME_HOSTS 集合不一致（顺序无所谓，集合必须相同）',
    )
  }
}

// ── 4. 上报端点必须存在，否则 Report-Only 收不到任何东西 ────────────────────
check(
  CSP_POLICY.includes('report-uri /api/csp-report'),
  'CSP_POLICY 缺少 report-uri —— Report-Only 会退化成"只往控制台刷日志"',
)
try {
  readFileSync(join(CMS_ROOT, 'src', 'app', 'api', 'csp-report', 'route.ts'), 'utf8')
} catch {
  failures.push('上报端点 src/app/api/csp-report/route.ts 不存在，但策略里声明了 report-uri')
}

// ── 输出 ────────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log(`[csp] 通过：策略 ${CSP_POLICY.length} 字符，两处取值一致，frame-src 覆盖 ${FRAME_HOSTS.length} 个 host`)
  process.exit(0)
}

console.error(`[csp] 失败 ${failures.length} 项：\n`)
for (const [i, f] of failures.entries()) console.error(`  ${i + 1}. ${f}`)
process.exit(1)
