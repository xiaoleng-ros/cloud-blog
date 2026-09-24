/**
 * 博客前台数据同步 —— 内存缓存层 + SSE 客户端注册
 *
 * 设计：
 * 1. 数据快照（snapshot）：缓存最近一次从数据库拉取的全量数据（posts/notes/projects/
 *    settings/nav）+ 计算出的版本号。短 TTL（5s）兜底，afterChange 钩子立即清除。
 *    → 无变化时 /api/blog-sync 直接命中快照，零查库、零渲染（~1ms）。
 * 2. 区块缓存（blockCache）：pathname → {version, title, blocks}。版本号一致时直接复用，
 *    避免对同一份数据重复跑 Markdown/Shiki 渲染。带 LRU 淘汰与上限，防止内存无限增长。
 * 3. SSE 客户端集合：afterChange 后向所有在线客户端广播 update 事件，实现近实时推送
 *    （取代 4 秒轮询的主路径）。注册时绑定 onError/onClose 自动清理，防止连接泄漏。
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

/** 区块缓存最大条目数：超出时按 LRU 策略淘汰最早写入的条目 */
const MAX_BLOCK_CACHE_SIZE = 100

/** SSE 客户端最大连接数：超出时拒绝新连接，防止内存泄漏 */
const MAX_SSE_CLIENTS = 500

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

// --- 区块缓存（LRU） ---

export function getBlock(pathname: string): CachedBlock | undefined {
  const entry = blockCache.get(pathname)
  // 命中后重新插入到 Map 末尾，实现 LRU 最近使用排序
  if (entry) {
    blockCache.delete(pathname)
    blockCache.set(pathname, entry)
  }
  return entry
}

export function setBlock(pathname: string, block: CachedBlock): void {
  // 达到上限时淘汰 Map 第一个条目（最久未使用）
  if (blockCache.size >= MAX_BLOCK_CACHE_SIZE && !blockCache.has(pathname)) {
    const oldestKey = blockCache.keys().next().value
    if (oldestKey) blockCache.delete(oldestKey)
  }
  blockCache.set(pathname, block)
}

/** 清除所有缓存（快照 + 区块）。afterChange/afterDelete 钩子调用 */
export function invalidateAll(): void {
  blockCache.clear()
  snapshotCache = null
}

// --- SSE ---

/**
 * 注册 SSE 客户端。
 * @param send 发送事件的回调
 * @param close 关闭连接的回调
 * @param onError 可选的连接异常回调，用于自动注销
 * @returns 注册的客户端对象，或在超出上限时返回 null
 */
export function registerSseClient(
  send: (event: string, data: unknown) => void,
  close: () => void,
  onError?: () => void,
): SseClient | null {
  // 超出最大连接数时拒绝新连接，防止资源耗尽
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return null
  }
  const client: SseClient = { id: ++clientIdSeq, send, close }
  sseClients.add(client)
  // 注册时若提供了 onError 回调，调用后自动注销该客户端
  if (onError) {
    try {
      onError()
    } catch {
      sseClients.delete(client)
    }
  }
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
      // 发送失败说明连接已断开，立即清理
      sseClients.delete(client)
      try {
        client.close()
      } catch {
        // close 失败也忽略，已经从集合中移除
      }
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
