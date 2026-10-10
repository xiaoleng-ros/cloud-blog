#!/usr/bin/env node
/**
 * 一键启动后台开发环境，并在「真正能服务」之后自动预热编译缓存。
 *
 *   npm run dev:warm           （= node scripts/dev-warm.mjs）
 *   WARM_COOKIE=<payload-token> npm run dev:warm   预热后台各页（需要登录 cookie）
 *
 * 背景（实测 2026-10-09）：
 *   1) `npm run dev` 打印 "Ready in ~1s"，但从进程启动到端口真正能响应约 10s；
 *   2) 第一个请求还要等 Payload 初始化 + schema push（"Pulling schema…"）约 6s；
 *   3) 之后每个 URL 首次访问再付一次 Turbopack 冷编译（后台单页 18~25s）。
 *   本脚本把 (1)(2) 的等待变成可见的输出等待，并用 warmup 把 (3) 提前付掉 ——
 *   浏览器打开时基本全热。代价是脚本本身要多跑十几秒到几十秒。
 *
 * 与 dev:local 的关系：dev:local = pg:start && dev（不动）；本脚本是额外的可选入口，
 * 语义 = pg:start && dev + 等就绪 + warmup，退出/Ctrl+C 时连同子进程树一起收干净。
 */
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

const CMS = path.resolve(import.meta.dirname, '..')
const IS_WIN = process.platform === 'win32'
const BASE = (process.env.PUBLIC_PAYLOAD_URL ?? 'http://127.0.0.1:9527').replace(/localhost/gi, '127.0.0.1')
const READY_TIMEOUT_MS = 180_000

// 1) 数据库（已在运行会直接返回；未 init 会自动 initdb）
const pg = spawnSync(process.execPath, [path.join(CMS, 'scripts', 'pg.mjs'), 'start'], {
  stdio: 'inherit',
})
if (pg.status !== 0) process.exit(pg.status ?? 1)

// 2) 起 dev：stdio 透传，Next 日志照常可见
const dev = spawn('npm', ['run', 'dev'], { cwd: CMS, stdio: 'inherit', shell: IS_WIN })

let exiting = false
/** 收掉整棵子进程树：Windows 上杀 npm 包装不会带上 next 子进程，必须 taskkill /T */
const killTree = () => {
  if (exiting) return
  exiting = true
  try {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore' })
    else dev.kill('SIGTERM')
  } catch {
    // 忽略：进程可能已退出
  }
}
process.on('SIGINT', () => {
  killTree()
  process.exit(130)
})
process.on('SIGTERM', () => {
  killTree()
  process.exit(143)
})

// 3) 等端口真正能响应（不是等 "Ready" 那行日志），再跑 warmup
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exiting) return false
    try {
      const res = await fetch(`${BASE}/api/blog-sync?digest=1`)
      if (res.ok) return true
    } catch {
      // 端口未就绪：继续等
    }
    await wait(1000)
  }
  return false
}

void (async () => {
  const ok = await waitReady()
  if (!ok) {
    console.log('\n[dev-warm] 等待 dev 就绪超时，跳过预热（不影响使用）\n')
    return
  }
  console.log('\n[dev-warm] dev 已就绪（首次响应通常还要等 Payload 初始化），开始预热…\n')
  const warm = spawn(process.execPath, [path.join(CMS, 'scripts', 'warmup.mjs')], {
    stdio: 'inherit',
    env: process.env,
  })
  warm.on('exit', () => {
    if (!exiting) console.log('\n[dev-warm] 预热结束，后台已全热，可以直接开浏览器了。\n')
  })
})()

dev.on('exit', (code) => {
  process.exit(code ?? 0)
})
