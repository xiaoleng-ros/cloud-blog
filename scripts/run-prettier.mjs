#!/usr/bin/env node
/**
 * 仓库级 Prettier 驱动。
 *
 * 为什么不用 `prettier .`：
 *   1. 根目录没有 node_modules 时可执行位在 Windows 上是 .cmd，跨平台调用要分叉；
 *   2. 需要「只看本轮改动的文件」（--changed），Prettier CLI 不支持；
 *   3. 需要自己决定「哪些文件不参与」（.astro 本仓库未装 prettier-plugin-astro，
 *      Prettier 会把它当未知类型；getFileInfo 返回 parser=null 即自动跳过）。
 *
 * 用法：
 *   node scripts/run-prettier.mjs --check          全量检查（CI 用，0 = 通过）
 *   node scripts/run-prettier.mjs --write          全量格式化
 *   node scripts/run-prettier.mjs --check --changed  只检查 git 有改动的文件（本地提 PR 前）
 *
 * 退出码：0 全部符合 / 1 有不符合 / 2 运行错误。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 遍历时不进入的目录：第三方代码与构建产物，进去只会白白耗时 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.astro', '.vite', 'dist', 'build', '.trae', '.workbuddy'])

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const changedOnly = args.has('--changed')

/** 递归收集候选文件（先做粗筛，真正的「要不要格式化」交给 Prettier 判断） */
function collect(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collect(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** git 有改动的文件（含未跟踪），相对仓库根。失败时回退为空数组并由调用方报错 */
function changedFiles() {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--no-renames', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    const files = []
    for (const entry of out.split('\0')) {
      if (!entry || entry.length < 4) continue
      const status = entry.slice(0, 2)
      if (status.includes('D')) continue // 已删除的文件不需要格式化
      files.push(entry.slice(3))
    }
    return files.map((f) => join(ROOT, f))
  } catch (err) {
    console.error(`[fmt] 无法读取 git 改动（--changed 需要 git）：${err?.message ?? err}`)
    process.exit(2)
  }
}

const candidates = changedOnly ? changedFiles() : collect(ROOT)

let checked = 0
const unformatted = []
const failed = []

for (const file of candidates) {
  // getFileInfo 会同时套用 .prettierignore 与 .editorconfig，并把 .astro 这类
  // 未安装插件的后缀判为 parser=null，正是我们想要的过滤规则。
  const info = await prettier.getFileInfo(file, { ignorePath: join(ROOT, '.prettierignore') })
  if (info.ignored || !info.inferredParser) continue

  checked += 1
  const source = readFileSync(file, 'utf8')
  let formatted
  try {
    formatted = await prettier.format(source, { ...(await prettier.resolveConfig(file)), filepath: file })
  } catch (err) {
    failed.push({ file, message: err?.message ?? String(err) })
    continue
  }
  if (formatted === source) continue

  if (write) {
    writeFileSync(file, formatted, 'utf8')
    unformatted.push(relative(ROOT, file).split(sep).join('/'))
  } else {
    unformatted.push(relative(ROOT, file).split(sep).join('/'))
  }
}

for (const { file, message } of failed) {
  console.error(`[fmt] 解析失败 ${relative(ROOT, file).split(sep).join('/')}\n      ${message}`)
}

if (write) {
  if (unformatted.length > 0) console.log(`[fmt] 已格式化 ${unformatted.length} 个文件`)
  else console.log('[fmt] 全部文件已符合格式要求')
} else if (unformatted.length > 0) {
  console.error(`[fmt] ${unformatted.length} 个文件格式不符合要求：`)
  for (const f of unformatted) console.error(`      ${f}`)
  console.error('[fmt] 运行 `npm run fmt` 自动修复')
} else {
  console.log(`[fmt] 检查通过（${checked} 个文件）`)
}

if (failed.length > 0) process.exit(2)
if (!write && unformatted.length > 0) process.exit(1)
