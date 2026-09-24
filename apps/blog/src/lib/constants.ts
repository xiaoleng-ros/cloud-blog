/**
 * 全局常量
 *
 * 将所有魔法值（Magic Number）集中定义，便于调试、统一调参和跨模块引用。
 * 避免在业务代码中硬编码数字字面量，减少"这个 4000 是从哪来的"的认知负担。
 */

/** SSE 连接地址：CMS 端通过 /api/blog-sync/stream 推送数据变更事件 */
export const SSE_STREAM_URL = '/api/blog-sync/stream'

/** 轮询地址：当 SSE 不可用时降级为轮询 /api/blog-sync 获取最新区块 */
export const POLL_URL = '/api/blog-sync'

/** SSE 初始化超时：30 秒内未完成首次数据同步则切换为轮询兜底 */
export const SSE_TIMEOUT_MS = 30_000

/** 轮询间隔：SSE 为主通道，轮询仅做兜底，30 秒一次足够兼顾实时性与带宽 */
export const POLL_INTERVAL_MS = 30_000
