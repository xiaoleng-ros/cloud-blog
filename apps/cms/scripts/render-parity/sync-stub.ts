/**
 * `apps/cms/src/lib/blog-sync.ts` 与 `sync-cache.ts` 的对照替身。
 *
 * 这两个模块一旦被 import 就会拖进 `@payload-config` → Payload 运行时 → 数据库连接，
 * 而渲染对照只想验证「同一份快照输入 → 同一份 HTML 输出」，不需要真实数据源。
 * loader.mjs 在渲染层引用它们时改指这个文件，快照通过 `__setSync()` 注入。
 *
 * 导出面必须覆盖渲染层用到的那几个名字，改名或新增时 loader 会当场报错（找不到导出），
 * 这正是要的：拆分改动漏同步会立刻暴露。
 */

let snapshot: unknown = null

export function __setSync(value: unknown) {
  snapshot = value
}

export async function getSyncData() {
  return snapshot as never
}

export function getBlock() {
  return undefined
}

export function setBlock() {}

export type FriendEntry = Record<string, unknown>
export type MdEntry = Record<string, unknown>
export type ProjectEntry = Record<string, unknown>
