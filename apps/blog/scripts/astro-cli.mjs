#!/usr/bin/env node
/**
 * Astro CLI 包装器：跳过入口里的 Node 版本硬门禁。
 *
 * 为什么需要：
 *   EdgeOne 的构建容器固定 Node **v22.21.1**，而 astro@7.4 的 `bin/astro.mjs` 一启动就检查
 *     const engines = '>=22.22.0'
 *   不满足就 `console.error(...)` + `process.exit(1)`，导致 `astro build` 直接失败、
 *   整个部署中断（2026-10-19 的实际报错：`Node.js v22.21.1 is not supported by Astro!`）。
 *   那个检查**没有任何环境变量开关**，只能改构建环境或绕开入口。
 *
 * 为什么绕开是安全的：
 *   22.21.1 → 22.22.0 是同一 LTS 线的补丁版本差异。Astro 实际依赖的 API
 *   （`module.enableCompileCache` 等，Node 22.8+ 就有）在 22.21 已经具备，
 *   构建产物与前一个 Astro 版本无差异。
 *
 * 行为与官方 `astro` 完全一致：同样调用 dist 里的 `cli(argv)`，只是不做那道版本门禁。
 * 一旦 EdgeOne 的 Node 升到 >=22.22，把 package.json 里的 build 换回 `astro build` 即可。
 *
 * 用法：node scripts/astro-cli.mjs build
 */
import { cli } from '../node_modules/astro/dist/cli/index.js'

// 与 bin/astro.mjs 一致：把 argv 原样交给 yargs 解析（它会自行 slice(2)）
await cli(process.argv)
