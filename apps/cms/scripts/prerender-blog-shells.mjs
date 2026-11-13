/**
 * 构建期把博客外壳静态化到 public 根（路线 A）。
 *
 * ## 为什么需要它
 *
 * 目前全部 HTML 都由 `src/app/[[...path]]/route.ts` catch-all 函数渲染，并固定发
 * `Cache-Control: no-store`（见 lib/html-compress.ts）。结果是**每次访问都要进一次
 * 云函数**：TTFB 被函数地板锁在 390–700 ms 起，CDN 完全没参与。同一份内容放在
 * public/ 里由静态层直出时是 200 ms + br + Cache Hit（实测见 docs/perf/00-加速方案.md §1）。
 *
 * EdgeOne 的路由优先级是「静态资源 > 函数」。本脚本把外壳写到 public 根之后，
 * 已构建的页面由静态层直出，函数只作为「构建后新增页面」（新文章/新分类/
 * 新标签/新归档页）的兜底。
 *
 * ## 为什么不需要连数据库，也不用 tsx
 *
 * Astro 构建期就已经从 Payload 拉过一遍全量数据，所以 `apps/blog/dist/` 里的 HTML
 * **锚点内已经烘焙了真实内容**（实测 `data-sync-block="heroCount"` 内是「全部 1 篇」，
 * 而不是模板默认文案）。也就是说 dist 产物本身就是「外壳 + 构建期数据」，
 * 直接静态化即可，无需在构建期再跑一遍服务端渲染器。
 *
 * 这同时规避了两个坑：
 *   1. `tsx` 依赖的 esbuild 需要 spawn 子进程，部分 CI/沙箱环境直接 EPERM
 *      （本机实测 `Error: spawn EPERM`），构建期执行 TS 渲染器并不可靠；
 *   2. 方案文档原拟「抓上一版线上 HTML 落盘」会把旧部署的 `_astro` 哈希带进来，
 *      与本次构建产出的新哈希对不上 → CSS/JS 全 404。
 * 这里复制的是**本次构建刚产出**的 dist HTML，哈希天然一致。
 *
 * ## 为什么注入 data-sync-version
 *
 * 客户端 `applyBlock` 的判断是「锚点上的 version 与服务端一致就跳过重写」。
 * 静态文件若不带该属性，首屏同步会把 13 个区块全部重新替换一遍（内容相同，视觉
 * 无变化，但多一次无谓的 DOM 重建）。这里写入构建期时间戳：首屏同步会重写一次，
 * 之后同版本一直跳过 —— 与函数注入路径的最终行为一致。
 *
 * ## 失败即降级
 *
 * 任何一页处理失败都跳过，不写静态文件 —— 该页继续由 catch-all 函数渲染，
 * 行为与加本脚本之前完全相同。最坏情况等价于「没加这个脚本」。
 *
 * ## 运行顺序（重要）
 *
 * 必须在 `copy-blog-to-public.mjs` **之后**：它每轮会 `rmSync` 整个 `public/__blog/`
 * 并重建，且首次运行（无清单）时会清理 public 根目录所有 .html。放在前面跑的产物
 * 会被一并删掉。本脚本自己的产物登记在 `.prerender-manifest.json`，下一轮按清单
 * 清理，不与 copy 脚本的清单交叉。
 *
 * 用法：`node scripts/prerender-blog-shells.mjs`
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const SCRIPT_DIR = import.meta.dirname
// apps/cms/public —— Next.js 静态资源目录（EdgeOne 部署为静态层）
const CMS_PUBLIC = join(SCRIPT_DIR, '../public')
// HTML 外壳目录（与 route.ts 的 HTML_DIR_NAME 保持一致）
const HTML_DIR_NAME = '__blog'
const HTML_ROOT = join(CMS_PUBLIC, HTML_DIR_NAME)
// 本脚本产物清单：记录写到了 public 根的哪些文件，供下轮精确清理
const MANIFEST_FILE = join(CMS_PUBLIC, '.prerender-manifest.json')

// 404 页静态化会污染静态层：任意未命中路径都可能被它接住并返回 200，
// 而真正的 404 语义由 route.ts 按数据层判定，必须留在函数里。
const SKIP_FILES = new Set(['404.html'])

/**
 * 旧 URL 形态必须留在函数里。
 *
 * Astro 会为「旧形态 /posts/{纯数字ID}/」也生成一份完整页面（无 adapter 时不执行
 * `getStaticPaths` 的 redirect），而 route.ts 靠 `resolveLegacyPostPath`
 * 对同一路径做**真 301** 到 `/posts/{分类标识}/{id}`（`route.ts:409-420`）。
 *
 * 一旦把这个路径静态化，EdgeOne 的「静态资源 > 函数」优先级会让静态文件直接命中，
 * 301 被彻底绕过 —— 旧链接、老书签、搜索引擎收录的 URL 会返回 200 而不是 301，
 * 正是 copy-blog-to-public.mjs 里 `shrinkLegacyDuplicateShells` 想避免的那类问题。
 */
function isLegacyPostPath(rel) {
  // posts/<纯数字>/index.html
  return /^posts\/\d+\/index\.html$/.test(rel)
}

/**
 * 构建期版本戳：写入每个锚点的 data-sync-version。
 * 取进程启动时间而非内容摘要 —— 目的是「让静态文件带一个确定的版本」，
 * 不是「判断数据是否变化」（客户端拿 /api/blog-sync 的 version 自行比对）。
 */
const BUILD_VERSION = String(Date.now())

if (!existsSync(HTML_ROOT)) {
  console.log('[prerender] 找不到外壳目录，跳过（请先跑 copy-blog-to-public.mjs）:', HTML_ROOT)
  process.exit(0)
}

/** 递归收集 index.html，返回相对 HTML_ROOT 的 posix 路径 */
function collectShells(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectShells(full))
      continue
    }
    if (entry.name !== 'index.html' || SKIP_FILES.has(entry.name)) continue
    out.push(relative(HTML_ROOT, full).split(sep).join('/'))
  }
  return out.sort()
}

/**
 * 给所有 `data-sync-block` 锚点补 data-sync-version，已有则覆盖。
 *
 * 只重写锚点的 open tag，文档其余字节保持不变（与 html-inject.ts 同一策略：
 * 不做全量 parse5 序列化，避免改动非锚点区域的原始字节）。
 */
function stampSyncVersion(html, version) {
  // 匹配「至少含一个 data-sync-block 属性的开始标签」。属性值允许单/双/无引号，
  // 但外壳由 Astro 产出，实际恒为双引号形态，这里只需覆盖该形态 + 兜底单引号。
  return html.replace(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (tag, name, attrs) => {
    if (!/\bdata-sync-block\s*=/.test(attrs)) return tag
    // 去掉已有的 version 属性（形如 data-sync-version="..."），避免重复
    const cleaned = attrs.replace(/\s+data-sync-version\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
    return `<${name}${cleaned} data-sync-version="${version}">`
  })
}

/** 读上一轮清单（相对 public 根的 posix 路径） */
function readPreviousManifest() {
  if (!existsSync(MANIFEST_FILE)) return []
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'))
    return Array.isArray(parsed?.files) ? parsed.files.map(String) : []
  } catch {
    return []
  }
}

const shells = collectShells(HTML_ROOT)
console.log(`[prerender] 待静态化外壳 ${shells.length} 个`)

const written = []

for (const rel of shells) {
  try {
    // 旧 URL 形态：必须留给函数做 301，见 isLegacyPostPath 注释
    if (isLegacyPostPath(rel)) {
      console.log(`[prerender] 跳过 ${rel}：旧 URL 形态，交由函数做 301`)
      continue
    }

    const srcPath = join(HTML_ROOT, ...rel.split('/'))
    const html = readFileSync(srcPath, 'utf-8')

    // 守卫：外壳必须是一份真实页面。
    //
    // 两种非真实页面必须留给函数：
    //   1. Astro 的 meta-refresh 重定向壳（形如 `<title>Redirecting to: /about</title>` +
    //      `<meta http-equiv="refresh">`，本仓库的 /projects → /about 就是这种）。
    //      静态化它没意义，且会让「静态层命中」先于函数，日后改跳转目标还要等静态文件更新。
    //   2. 不完整的片段。
    //
    // 注：曾经的实现要求「至少一个 data-sync-block 锚点」，那是错的 ——
    // 纯静态页（内容全在构建期烘焙）本来就没有锚点，静态化它反而是最优解，
    // 这类页面永远不需要运行时注入，交给函数只会白花一次冷启动。
    const isRedirectShell = /http-equiv=["']?refresh/i.test(html.slice(0, 1024))
    if (isRedirectShell || !/<html[\s>]/i.test(html)) {
      console.log(`[prerender] 跳过 ${rel}：${isRedirectShell ? '重定向壳' : '不是完整 HTML 文档'}，交由函数处理`)
      continue
    }

    const stamped = stampSyncVersion(html, BUILD_VERSION)

    // 写到 public 根的同名位置：public/about/index.html 会被 /about 命中（已实测）。
    const outPath = join(CMS_PUBLIC, ...rel.split('/'))
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, stamped, 'utf-8')
    written.push(rel)
  } catch (err) {
    // 单页失败不影响其余页面；该页退回函数渲染
    console.warn(`[prerender] ${rel} 处理失败，跳过:`, err?.message ?? err)
  }
}

// 清理：只删本脚本上一轮写过、本轮不再产出的文件（例如文章被删除后的残留页面）
const previous = readPreviousManifest()
const currentSet = new Set(written)
let removed = 0
for (const rel of previous) {
  if (currentSet.has(rel)) continue
  const stale = join(CMS_PUBLIC, ...rel.split('/'))
  if (existsSync(stale)) {
    rmSync(stale, { force: true })
    removed += 1
  }
}
if (removed > 0) {
  console.log(`[prerender] 清理上一轮残留静态页 ${removed} 个`)
}

writeFileSync(MANIFEST_FILE, JSON.stringify({ version: BUILD_VERSION, files: written }, null, 2))

console.log(
  `[prerender] 完成：静态化 ${written.length} 页，跳过 ${shells.length - written.length} 页（跳过的继续由函数渲染）`,
)
