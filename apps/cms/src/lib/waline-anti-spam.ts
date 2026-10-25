/**
 * 反垃圾：IPQPS 限流 + 敏感词 + Akismet（可选）。
 *
 * 全部走内存（进程内），EdgeOne 函数多实例下会有误差，但作为第一道防线足够；
 * 真正的全局限流靠 Supabase 的事务池 + 数据库唯一约束兜底。
 */

// ==================== IPQPS 限流 ====================

interface IpBucket {
  count: number
  resetAt: number
}

const ipBuckets = new Map<string, IpBucket>()

/** 默认每秒 1 次评论，可通过 IPQPS 环境变量覆盖 */
const IPQPS = Number(process.env.IPQPS ?? 1) || 1
const WINDOW_MS = 1000

/**
 * 检查某 IP 是否在限流窗口内。返回 true 表示「已超限，应拒绝」。
 * 实现：固定窗口计数，窗口结束自动清零。
 */
export function rateLimitIp(ip: string): boolean {
  if (!ip || IPQPS <= 0) return false
  const now = Date.now()
  const bucket = ipBuckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  bucket.count++
  if (bucket.count > IPQPS) return true
  return false
}

// ==================== 小时级配额（第二道闸） ====================

/**
 * 为什么光有 IPQPS 不够：
 * 1 次/秒的窗口只拦「瞬间连发」，一个 IP 匀速每秒一条，一天能灌 86400 条。
 * 默认 COMMENT_AUDIT 未关，这些都会进 waiting 待审队列 —— 数据库照样被灌满，
 * 后台审核页每条都要跑一次 Markdown 渲染，等于把审核人拖死。
 *
 * 所以再加一道滑动上限：同一 IP 每小时最多 COMMENT_IP_HOURLY 条（默认 20）。
 * 正常访客一小时发 20 条已经很多了；脚本刷量则会立刻撞墙。
 *
 * 注意：内存计数在 EdgeOne 多实例/冷启动下不精确（每个实例独立计数）。
 * 这是「提高成本」而不是「绝对封死」——要绝对封死得落库计数，
 * 那会在评论主链路上多一次写，得不偿失。
 */
const IP_HOURLY = Number(process.env.COMMENT_IP_HOURLY ?? 20) || 20
const HOUR_MS = 60 * 60 * 1000

interface QuotaBucket {
  count: number
  resetAt: number
}
const ipQuota = new Map<string, QuotaBucket>()

/**
 * 取不到可信 IP 时用的全局兜底桶。
 * 关键取舍：不能把所有「无 IP」请求塞进同一个 keyed 桶后**放行**（那等于没有限制），
 * 也不能直接拒绝（某些健康检查/内网调用会挂）。折中：给一个小得多的共享额度。
 */
const FALLBACK_KEY = '__no_ip__'
const NO_IP_HOURLY = Number(process.env.COMMENT_NOIP_HOURLY ?? 30) || 30

/** 返回 true 表示「该 IP 本小时额度已用尽，应拒绝」 */
export function exceedHourlyQuota(ip: string): boolean {
  if (IP_HOURLY <= 0) return false
  const key = ip || FALLBACK_KEY
  const limit = ip ? IP_HOURLY : NO_IP_HOURLY
  const now = Date.now()

  if (ipQuota.size > 5000) {
    for (const [k, rec] of ipQuota) {
      if (now > rec.resetAt) ipQuota.delete(k)
    }
  }

  const rec = ipQuota.get(key)
  if (!rec || now > rec.resetAt) {
    ipQuota.set(key, { count: 1, resetAt: now + HOUR_MS })
    return false
  }
  rec.count++
  return rec.count > limit
}

// 定期清理过期的 ip bucket，防止内存泄漏（每分钟扫一次）
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of ipBuckets) {
    if (bucket.resetAt < now) ipBuckets.delete(ip)
  }
  for (const [ip, rec] of ipQuota) {
    if (rec.resetAt < now) ipQuota.delete(ip)
  }
}, 60_000).unref()

// ==================== 敏感词 ====================

/**
 * 敏感词列表，来自 FORBIDDEN_WORDS 环境变量（逗号分隔）。
 * 命中任一即返回该词，否则返回 null。
 */
const forbiddenWords = (process.env.FORBIDDEN_WORDS ?? '')
  .split(',')
  .map((w) => w.trim())
  .filter(Boolean)

export function hitForbiddenWords(text: string): string | null {
  if (!forbiddenWords.length) return null
  const lower = text.toLowerCase()
  for (const word of forbiddenWords) {
    if (lower.includes(word.toLowerCase())) return word
  }
  return null
}

// ==================== Akismet ====================

interface AkismetInput {
  comment: string
  nick?: string
  mail?: string
  ip: string
  ua: string
}

/**
 * 调用 Akismet API 判断是否为垃圾评论。
 * 需要 AKISMET_KEY 环境变量；未配置时返回 null（不参与判定）。
 * 返回 'spam' / 'ham' / null。
 *
 * 文档：https://akismet.com/development/api/#comment-check
 */
export async function akismetCheck(input: AkismetInput): Promise<'spam' | 'ham' | null> {
  const key = process.env.AKISMET_KEY
  const blog = process.env.AKISMET_BLOG || process.env.NEXT_PUBLIC_SERVER_URL
  if (!key || !blog) return null

  const body = new URLSearchParams({
    blog,
    user_ip: input.ip,
    user_agent: input.ua,
    comment_type: 'comment',
    comment_author: input.nick ?? '',
    comment_author_email: input.mail ?? '',
    comment_content: input.comment,
  })

  try {
    const response = await fetch(`https://${key}.rest.akismet.com/1.1/comment-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const text = await response.text()
    return text.trim() === 'true' ? 'spam' : 'ham'
  } catch (err) {
    // Akismet 不可用时不阻塞评论，只记日志
    console.warn('[akismet] 调用失败，跳过判定', err instanceof Error ? err.message : err)
    return null
  }
}
