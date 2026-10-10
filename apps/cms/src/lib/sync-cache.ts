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
 *    （取代 4 秒轮询的主路径）。send 返回 false 表示连接已写不进去（客户端断开），
 *    广播时立即注销并关闭，防止死连接常驻集合与心跳定时器泄漏。
 *
 * 限制（已知）：内存缓存与 SSE 连接均为单实例级。EdgeOne 多实例时，未承接写入的实例
 * 依赖 TTL 自愈 + 客户端轮询兜底，最终一致。
 */

export interface CachedBlock {
  version: string
  title: string | null
  blocks: Record<string, string | null>
  /** 页面在数据层不存在（文章/分类/标签/归档页码查无此物）：模板兜底分支据此改判 404 */
  notFound?: boolean
  ts: number
}

export interface SyncSnapshot {
  posts: any[]
  notes: any[]
  projects: any[]
  settings: Record<string, any> | null
  nav: Array<{ href: string; label: string }>
  navUpdatedAt?: string
  /** Media 集合 url → alt 映射，Markdown 正文图片补 alt 用 */
  mediaAltMap: Map<string, string>
  /** 各数据源的「条数:最大 updatedAt」，供 /api/blog-sync?digest=1 轻量探测 */
  digests?: Record<string, string>
  version: string
  ts: number
}

/**
 * 快照最大存活时间：超过则视为过期，下次取用时重新查库（多实例自愈兜底）。
 *
 * dev 下放宽到 60s：本地直连东京库时一次全量快照要跑 6 条跨公网查询，5s 一过期
 * 等于每次刷新都重付一遍往返；而后台改数据仍靠 afterChange 钩子即时 invalidate，
 * 所以放宽 TTL 不会让本地「看不到新内容」，只是少了无谓的重新查库。
 */
const SNAPSHOT_TTL_MS = process.env.NODE_ENV === 'production' ? 5_000 : 60_000

/** 区块缓存最大条目数：超出时按 LRU 策略淘汰最早写入的条目 */
const MAX_BLOCK_CACHE_SIZE = 100

/** SSE 客户端最大连接数：超出时拒绝新连接，防止内存泄漏 */
const MAX_SSE_CLIENTS = 500

/**
 * 全进程共享状态。
 *
 * 必须挂在 globalThis 上而不是模块顶层变量：Next 会为每个路由单独打包，同一份源码
 * 在不同路由里是不同模块实例。后台 afterChange 钩子跑在 Payload REST 路由的实例里，
 * SSE 连接注册在 /api/blog-sync/stream 路由的实例里，两者若各持一份集合与缓存，
 * 广播和缓存失效都只会打在自己的空集合上（实测本地 dev 就是这个现象：客户端永远收不到 update）。
 */
interface SyncCacheState {
  blockCache: Map<string, CachedBlock>
  snapshotCache: SyncSnapshot | null
  sseClients: Set<SseClient>
  clientIdSeq: number
  /** 定期扫描的「代数」：只有最新登记的那条定时器链在跑，防止模块被重复实例化时留下孤儿 */
  sweepGeneration: number
  /**
   * 缓存写入静默期截止（epoch ms）。afterChange 钩子跑在事务提交**之前**：
   * 若此刻有并发读者拿旧数据重建快照并缓存，会把「已失效」悄悄变回「缓存旧内容直到 TTL」。
   * 失效钩子触发后短暂拒绝写入新快照/区块（读请求照常实时查库），跨过提交窗口。
   */
  cacheWriteBypassUntil: number
}

const STATE_KEY = '__cloudBlogSyncCacheState'
const globalWithState = globalThis as typeof globalThis & { [STATE_KEY]?: SyncCacheState }

function createState(): SyncCacheState {
  return {
    blockCache: new Map<string, CachedBlock>(),
    snapshotCache: null,
    sseClients: new Set<SseClient>(),
    clientIdSeq: 0,
    sweepGeneration: 0,
    cacheWriteBypassUntil: 0,
  }
}

const state = globalWithState[STATE_KEY] ?? (globalWithState[STATE_KEY] = createState())
const { blockCache, sseClients } = state

export interface SseClient {
  id: number
  /** 写入一帧；返回 false 表示连接已不可写，调用方应据此注销该客户端 */
  send: (event: string, data: unknown) => boolean
  close: () => void
  /** 连接是否还能继续写（未关闭、且队列没有堆积）。定期扫描用它回收「断开信号丢失」的连接 */
  alive: () => boolean
}

// --- 快照 ---

export function getSnapshot(): SyncSnapshot | null {
  const s = state.snapshotCache
  if (!s) return null
  if (Date.now() - s.ts > SNAPSHOT_TTL_MS) {
    state.snapshotCache = null
    return null
  }
  return s
}

export function setSnapshot(snapshot: SyncSnapshot): void {
  if (Date.now() < state.cacheWriteBypassUntil) return
  state.snapshotCache = snapshot
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
  if (Date.now() < state.cacheWriteBypassUntil) return
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
  state.snapshotCache = null
  // 钩子先于事务提交触发：接下来 1.5s 内禁止把（可能仍是提交前旧数据的）重建结果写回缓存，
  // 读请求不阻塞、只是不缓存，跨过提交窗口后恢复正常缓存。
  state.cacheWriteBypassUntil = Math.max(state.cacheWriteBypassUntil, Date.now() + 1_500)
}

// --- SSE ---

/**
 * 注册 SSE 客户端。
 * @param spec send 写一帧、close 幂等关闭、alive 判断连接是否还写得进去
 * @returns 注册的客户端对象，或在超出上限时返回 null
 */
export function registerSseClient(spec: Omit<SseClient, 'id'>): SseClient | null {
  // 超出最大连接数时拒绝新连接，防止资源耗尽
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return null
  }
  const client: SseClient = { id: (state.clientIdSeq += 1), ...spec }
  sseClients.add(client)
  return client
}

export function unregisterSseClient(client: SseClient): void {
  sseClients.delete(client)
}

export function sseClientCount(): number {
  return sseClients.size
}

/** 向所有在线客户端广播事件；写失败（返回 false 或抛错）则立即剔除该客户端 */
export function broadcastSse(event: string, data: unknown): void {
  // 复制一份再遍历：剔除死连接时不会改动正在迭代的集合
  for (const client of [...sseClients]) {
    let delivered = false
    try {
      delivered = client.send(event, data)
    } catch {
      delivered = false
    }
    if (delivered) continue
    // 写不进去说明连接已断开，立刻注销，否则心跳会一直为一个死连接空转
    sseClients.delete(client)
    try {
      client.close()
    } catch {
      // close 失败也忽略，已经从集合中移除
    }
  }
}

/**
 * 定期扫描：回收「断开信号丢失」的连接。
 * 浏览器断开后 enqueue 不一定报错（字节只是排进流自己的队列），abort / cancel 也不保证被
 * 运行时触发，所以集合需要一个与信号无关的自愈入口：凡是 alive() 为 false 的立即注销并关闭。
 * @returns 本轮回收的连接数
 */
export function sweepSseClients(): number {
  let dropped = 0
  for (const client of [...sseClients]) {
    let ok = false
    try {
      ok = client.alive()
    } catch {
      ok = false
    }
    if (ok) continue
    sseClients.delete(client)
    dropped += 1
    try {
      client.close()
    } catch {
      // 已经移出集合，关闭失败也不影响回收
    }
  }
  return dropped
}

/** 定期扫描周期 */
const SSE_SWEEP_MS = 60_000

/**
 * 启动（或接管）定期扫描。
 * 用全局代数保证全进程只有一条定时器链在跑：SSE 路由模块可能被重复实例化，
 * 每次实例化都会让旧的定时器链在下一跳自行退出，避免孤儿扫描越积越多。
 */
export function ensureSseSweepLoop(): void {
  const myGeneration = (state.sweepGeneration += 1)
  const tick = () => {
    if (myGeneration !== state.sweepGeneration) return
    sweepSseClients()
    setTimeout(tick, SSE_SWEEP_MS).unref?.()
  }
  setTimeout(tick, SSE_SWEEP_MS).unref?.()
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
