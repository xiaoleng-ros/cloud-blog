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

// 定期清理过期的 ip bucket，防止内存泄漏（每分钟扫一次）
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of ipBuckets) {
    if (bucket.resetAt < now) ipBuckets.delete(ip)
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
