/**
 * 博客前台数据同步 —— 内存缓存层 + SSE 客户端注册
 *
 * 设计：
 * 1. 数据快照（snapshot）：缓存最近一次从数据库拉取的全量数据（posts/notes/projects/
 *    settings/nav）+ 计算出的版本号。短 TTL（5s）兜底，afterChange 钩子立即清除。
 *    → 无变化时 /api/blog-sync 直接命中快照，零查库、零渲染（~1ms）。
 * 2. 区块缓存（blockCache）：pathname → {version, title, blocks}。版本号一致时直接复用，
 *    避免对同一份数据重复跑 Markdown/Shiki 渲染。
 * 3. SSE 客户端集合：afterChange 后向所有在线客户端广播 update 事件，实现近实时推送
 *    （取代 4 秒轮询的主路径）。
 *
 * 限制（已知）：内存缓存与 SSE 连接均为单实例级。EdgeOne 多实例时，未承接写入的实例
 * 依赖 TTL 自愈 + 客户端轮询兜底，最终一致。
 */

export interface CachedBlock {
  version: string
  title: string | null
  blocks: Record<string, string | null>
  ts: number
}

export interface SyncSnapshot {
  posts: any[]
  notes: any[]
  projects: any[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string }>
  navUpdatedAt?: string
  version: string
  ts: number
}

/** 快照最大存活时间：超过则视为过期，下次取用时重新查库（多实例自愈兜底） */
const SNAPSHOT_TTL_MS = 5_000

const blockCache = new Map<string, CachedBlock>()
let snapshotCache: SyncSnapshot | null = null

const sseClients = new Set<SseClient>()
let clientIdSeq = 0

export interface SseClient {
  id: number
  send: (event: string, data: unknown) => void
  close: () => void
}

// --- 快照 ---

export function getSnapshot(): SyncSnapshot | null {
  const s = snapshotCache
  if (!s) return null
  if (Date.now() - s.ts > SNAPSHOT_TTL_MS) {
    snapshotCache = null
    return null
  }
  return s
}

export function setSnapshot(snapshot: SyncSnapshot): void {
  snapshotCache = snapshot
}

// --- 区块缓存 ---

export function getBlock(pathname: string): CachedBlock | undefined {
  return blockCache.get(pathname)
}

export function setBlock(pathname: string, block: CachedBlock): void {
  blockCache.set(pathname, block)
}

/** 清除所有缓存（快照 + 区块）。afterChange/afterDelete 钩子调用 */
export function invalidateAll(): void {
  blockCache.clear()
  snapshotCache = null
}

// --- SSE ---

export function registerSseClient(
  send: (event: string, data: unknown) => void,
  close: () => void,
): SseClient {
  const client: SseClient = { id: ++clientIdSeq, send, close }
  sseClients.add(client)
  return client
}

export function unregisterSseClient(client: SseClient): void {
  sseClients.delete(client)
}

export function sseClientCount(): number {
  return sseClients.size
}

/** 向所有在线客户端广播事件；个别发送失败则剔除该客户端 */
export function broadcastSse(event: string, data: unknown): void {
  for (const client of sseClients) {
    try {
      client.send(event, data)
    } catch {
      sseClients.delete(client)
    }
  }
}

/**
 * 数据变更钩子：清缓存 + 广播 SSE update。
 * 挂在 posts/notes/projects 集合与 site-settings/navigation 全局的 afterChange/afterDelete。
 * 仅做内存操作，不阻塞写入。
 */
export async function syncInvalidateHook(): Promise<void> {
  invalidateAll()
  broadcastSse('update', { at: Date.now() })
}
