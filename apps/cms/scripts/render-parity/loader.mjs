/**
 * 渲染对照用的模块解析钩子。
 *
 * 两件事：
 * 1. 补全 Next 风格的无扩展名 import（`cloud-blog/shared/x` 走 tsconfig paths，
 *    相对 import 也不带扩展名）。裸 Node 的 ESM 解析器既不认 tsconfig paths，
 *    也不会补 `.ts`，直接 import 必然报 `Cannot find module '.../shared/html-safety'`。
 * 2. 把仅有的两个「一 import 就摸数据库」的模块换成桩：`./blog-sync`
 *    （内含 `import ... from '@payload-config'`，会 `ERR_INVALID_MODULE_SPECIFIER`）
 *    与 `./sync-cache`。桩通过 `__setSync()` 注入快照，于是校验脚本能在
 *    **不启动 Next、不连数据库** 的前提下跑真实的渲染代码。
 *
 * 这样就不必生成 `blog-render.probe.ts` 这类副本——校验跑的永远是源码本身，
 * 拆分或改动后漏改的地方会当场暴露，而不是被一份过期的副本掩盖。
 *
 * 用法（必须用 --experimental-loader；--import 拿不到 resolve 钩子）：
 *   node --experimental-strip-types --experimental-loader ./scripts/render-parity/loader.mjs ...
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// scripts/render-parity → scripts → apps/cms → apps → 仓库根
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const SHARED_DIR = pathToFileURL(join(REPO_ROOT, 'shared') + '/')

const EXTS = ['.ts', '.mjs', '.js', '/index.ts']

const STUB_URL = new URL('./sync-stub.ts', import.meta.url).href
const STUBBED = new Set(['blog-sync', 'sync-cache'])

export async function resolve(specifier, context, nextResolve) {
  // 只拦渲染层对 blog-sync / sync-cache 的引用，其它地方的用法保持原样
  if (context.parentURL?.includes('/src/lib/') && STUBBED.has(specifier.replace(/^\.{1,2}\//, ''))) {
    return { url: STUB_URL, shortCircuit: true }
  }
  if (specifier.startsWith('cloud-blog/shared/')) {
    const rest = specifier.slice('cloud-blog/shared/'.length)
    for (const ext of EXTS) {
      const url = new URL(rest + ext, SHARED_DIR)
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
    }
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const base = new URL(specifier, context.parentURL)
    if (!/\.(ts|tsx|mjs|js|json)$/.test(base.pathname)) {
      for (const ext of EXTS) {
        const url = new URL(base.href + ext)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}

/**
 * `.tsx` 的类型剥离。
 *
 * Node 22 的类型剥离只认 `.ts` / `.mts`，遇到 `.tsx` 会 `ERR_UNKNOWN_FILE_EXTENSION`。
 * 渲染层这两个 `.tsx` 文件里其实一行 JSX 都没有（历史命名），所以直接按
 * `module-typescript` 交给 Node 剥离即可；真出现 JSX 会在解析时报错，不会静默跑错。
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    return { format: 'module-typescript', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true }
  }
  // 仓库根的 package.json 没有 "type" 字段（apps/* 各自是独立包），Node 加载
  // shared/*.ts 时会猜格式并警告「按 ESM 重解析，有性能开销」。这里直接指定格式，
  // 既消掉噪音，也避免真有 CommonJS 写法时被误判。
  if (url.endsWith('.ts') && url.includes('/shared/')) {
    return { format: 'module-typescript', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true }
  }
  return nextLoad(url, context)
}
