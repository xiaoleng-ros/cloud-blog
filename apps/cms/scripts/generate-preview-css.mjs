// 生成脚本：读取前台 apps/blog 的 global.css，产出后台预览用的 TS 样式字符串模块
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../blog/src/styles/global.css')
const out = resolve(here, '../src/editor/markdown-preview-css.ts')

// 1) 读前台全局样式
let css = readFileSync(src, 'utf8')

// 2) 变量作用域改为预览根节点（shadow 内 :root/html 均不匹配）
css = css.replace(/:root\s*{/, '.markdown-preview {')
css = css.replace(/html\[data-theme="dark"\]/g, '.markdown-preview-dark')

// 3) 转义为模板字符串
const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  '// 由 scripts/generate-preview-css.mjs 生成，勿手改。\n' +
  'export const markdownPreviewCss = `\n' +
  escaped +
  '\n`\n',
  'utf8',
)
console.log(`done -> ${out} (${css.length} chars)`)