import { createHash } from 'node:crypto'

/**
 * 评论身份：邮箱头像 + UA 解析 + IP 属地。
 *
 * 这三样都是「读的时候算」而不是「写的时候存」：
 * - 头像：邮箱 md5 是纯函数，存库等于把可随时换风格的参数写死。
 * - UA：库里已有 ua 字符串，解析一次几微秒。
 * - 属地：需要外部查询，存库就冻结了当时的结果，回头换数据源也没法纠正。
 *
 * 于是 wl_comment 表结构一行都不用改，零迁移。
 */

/* ==================== 头像 ==================== */

/**
 * 头像服务：WeAvatar（weavatar.com）。
 *
 * 选它而不是 gravatar.com / cravatar.cn 的三个硬理由（都是实测出来的）：
 * 1. 回源顺序是「自己的 → Gravatar → QQ」，所以 QQ 号邮箱、英文 QQ 邮箱、
 *    foxmail 这类国内邮箱也能拿到真头像；gravatar.com 对国内邮箱基本一片空白。
 * 2. gravatar.com 与 cn.gravatar.com 在国内直连不通（实测 TypeError/超时），
 *    cravatar.cn 首次请求中位数 5.2s 且会返回空 body；weavatar 中位数 152ms。
 * 3. `d=` 参数只在「确实没有头像」时才生效：已有 Gravatar 的账号即使写
 *    `d=identicon` 也返回真图（实测与 `d=404` 逐字节相同），不会出现
 *    gravatar 官方那种用默认图盖掉真头像的情况。
 */
const AVATAR_HOST = 'https://weavatar.com/avatar'

/** 兜底风格：identicon 每个邮箱各不相同，绝不出现全员共用一张灰图。 */
const AVATAR_FALLBACK = 'identicon'
const AVATAR_SIZE = 100

/** QQ 号邮箱：直连 qlogo 拿原始头像，比走第三方转码更快也更清晰。 */
const QQ_MAIL_RE = /^(\d{5,12})@qq\.com$/i

/** 取邮箱对应头像 URL。无邮箱返回空串（客户端会不渲染头像元素）。 */
export function avatarOf(mail: string | null | undefined): string {
  const email = (mail ?? '').trim().toLowerCase()
  if (!email) return ''

  const qq = QQ_MAIL_RE.exec(email)
  if (qq) return `https://q1.qlogo.cn/g?b=qq&nk=${qq[1]}&s=${AVATAR_SIZE}`

  const hash = createHash('md5').update(email).digest('hex')
  return `${AVATAR_HOST}/${hash}?d=${AVATAR_FALLBACK}&s=${AVATAR_SIZE}`
}

/**
 * 评论头像：优先邮箱；老评论（邮箱必填之前发的）没有邮箱，退回按昵称生成，
 * 至少保证每张图稳定且彼此不同，而不是所有人共用一张灰图或裂图。
 */
export function avatarFor(
  mail: string | null | undefined,
  nick: string | null | undefined,
): string {
  const byMail = avatarOf(mail)
  if (byMail) return byMail
  const name = (nick ?? '').trim()
  if (!name) return ''
  const hash = createHash('md5').update(`nick:${name}`).digest('hex')
  return `${AVATAR_HOST}/${hash}?d=${AVATAR_FALLBACK}&s=${AVATAR_SIZE}`
}

/* ==================== UA 解析 ==================== */

export interface ParsedUa {
  browser: string
  os: string
}

/**
 * 简易 UA 解析。不引 ua-parser-js（~1.3MB），正则覆盖主流浏览器/系统即可。
 * 顺序敏感：Edg 含 Chrome 标识，Chrome 含 Safari 标识，必须从具体到宽泛。
 */
export function parseUa(ua: string | null | undefined): ParsedUa {
  if (!ua) return { browser: '', os: '' }

  let browser = ''
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  let os = ''
  // 顺序敏感：iPhone 的 UA 里含 "like Mac OS X"，先判 iOS 再判 macOS，
  // 否则所有 iPhone/iPad 都会被识别成 macOS。
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11'
  else if (/Windows NT/.test(ua)) os = 'Windows'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Linux/.test(ua)) os = 'Linux'

  return { browser, os }
}

/** 一次性算出除属地外的全部身份字段。 */
export function identityOf(raw: {
  mail?: string | null
  ua?: string | null
  nick?: string | null
}): { avatar: string; browser: string; os: string } {
  const { browser, os } = parseUa(raw.ua)
  return { avatar: avatarFor(raw.mail, raw.nick), browser, os }
}

/* ==================== IP 属地 ==================== */

/** 属地结果缓存：同一 IP 反复出现时不重复打外网。 */
const addrCache = new Map<string, { value: string; expires: number }>()
const ADDR_TTL_OK = 6 * 60 * 60 * 1000
const ADDR_TTL_FAIL = 10 * 60 * 1000
/** 单次查询上限。实测 280ms–1200ms，冷启动偶发 2500ms，留到 3.5s。 */
const ADDR_TIMEOUT = 3500
/** 一次列表响应的属地查询总预算，超时剩下的 IP 留空（不缓存，下次再试）。 */
const ADDR_BUDGET = 4000
const ADDR_CONCURRENCY = 8

function cacheGet(ip: string): string | undefined {
  const hit = addrCache.get(ip)
  if (!hit) return undefined
  if (hit.expires < Date.now()) {
    addrCache.delete(ip)
    return undefined
  }
  return hit.value
}

function cacheSet(ip: string, value: string): void {
  // 上限保护：地图站点评论多起来也不至于无限增长
  if (addrCache.size > 5000) addrCache.clear()
  addrCache.set(ip, { value, expires: Date.now() + (value ? ADDR_TTL_OK : ADDR_TTL_FAIL) })
}

/** 内网/本机地址没有归属地，直接跳过查询。 */
function isPublicIp(ip: string): boolean {
  if (!ip) return false
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return false
  return true
}

/**
 * 查单个 IP 的属地。失败一律返回空串，绝不抛错、绝不阻塞评论。
 * 数据源 ip.zxinc.org：中文、https、无需 key、覆盖国内省市级。
 */
export async function lookupAddr(ip: string | null | undefined): Promise<string> {
  const text = (ip ?? '').trim()
  if (!text || !isPublicIp(text)) return ''

  const cached = cacheGet(text)
  if (cached !== undefined) return cached

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ADDR_TIMEOUT)
    const response = await fetch(
      `https://ip.zxinc.org/api.php?type=json&ip=${encodeURIComponent(text)}`,
      { signal: controller.signal, headers: { accept: 'application/json' } },
    )
    clearTimeout(timer)
    if (!response.ok) {
      cacheSet(text, '')
      return ''
    }
    const body = (await response.json()) as { data?: { country?: string } }
    // 注意字段嵌在 data 下：顶层 country 恒为空
    const country = (body.data?.country ?? '').trim()
    cacheSet(text, country)
    return country
  } catch {
    // 超时/网络错误不缓存空值：下次这个 IP 还有机会查到
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[comment-identity] 属地查询失败 ip=${text}`)
    }
    return ''
  }
}

/**
 * 批量查属地，返回 ip → 属地 的映射。
 * 去重后并发查询，并发度受 limit 限制，整体受 budget 毫秒总预算约束：
 * 超预算的 IP 直接留空，宁可少一个徽章也不能让评论区转圈十几秒。
 */
export async function lookupAddrs(
  ips: (string | null | undefined)[],
  limit = ADDR_CONCURRENCY,
  budget = ADDR_BUDGET,
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      ips
        .map((ip) => (ip ?? '').trim())
        .filter((ip) => ip && isPublicIp(ip)),
    ),
  ]

  const result = new Map<string, string>()
  if (!unique.length) return result

  // 缓存命中先填满，真正要打网络的只剩少数
  const pending: string[] = []
  for (const ip of unique) {
    const cached = cacheGet(ip)
    if (cached !== undefined) result.set(ip, cached)
    else pending.push(ip)
  }
  if (!pending.length) return result

  const deadline = Date.now() + budget
  for (let i = 0; i < pending.length; i += limit) {
    if (Date.now() > deadline) break
    const batch = pending.slice(i, i + limit)
    const settled = await Promise.all(batch.map(async (ip) => [ip, await lookupAddr(ip)] as const))
    for (const [ip, addr] of settled) result.set(ip, addr)
  }
  return result
}
