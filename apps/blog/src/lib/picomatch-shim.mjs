// picomatch 是 CJS 包（index.js 第一行 const pico = require('./lib/picomatch')）。
// Vite 8 的 ModuleRunner 把非 external 的依赖内联进 ESM 沙箱直接 eval，
// CJS 入口里的 require 会报 "require is not defined"，导致 Astro dev server app
// 创建失败、所有请求挂起（见 repro-vite.mjs 的复现与堆栈）。
//
// 这里用 createRequire 让 Node 原生 CJS loader 加载 picomatch，再以 ESM 命名导出
// 暴露它的 API。astro.config.mjs 里通过 resolve.alias 把 'picomatch' 指到本文件。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pm = require('picomatch')

// picomatch 本身是函数，同时挂载 isMatch / makeRe 等静态方法
const picomatch = pm
export const isMatch = pm.isMatch
export const makeRe = pm.makeRe
export const scan = pm.scan
export const parse = pm.parse
export const compileRe = pm.compileRe
export const toRegex = pm.toRegex
export default picomatch
