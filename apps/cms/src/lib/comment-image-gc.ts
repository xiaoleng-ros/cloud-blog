import { Client } from 'pg'
import { resolvePgTls } from './pg-tls'
import { resolveStorageConfig } from './supabase-storage'

/**
 * 评论配图的垃圾回收（核心逻辑）。
 *
 * 为什么需要回收：Waline 的 `imageUploader` 在**选文件那一刻**就被调用，拿到 URL 才写进正文，
 * 所以「先传图、后提交评论」是框架固有顺序，必然留下三类孤儿：
 *   1. 选了图但没点发送就离开页面
 *   2. 评论是待审 / 垃圾，长期不给通过
 *   3. 评论被删除
 *
 * 规则（图片与评论记录都要清）：
 *   - 图片：没有任何评论引用 → 超过 24h 删；只被 waiting / spam 引用 → 超过 7 天删；
 *           被 approved 引用 → 永不删除
 *   - 评论记录：非 approved 且超过 7 天 → 连整棵回复子树一起删（2026-10-19 用户确认：
 *           「没审或判不通过，7 天后文字和图片一起清掉」）
 *
 * 这样「审核通过才算真正留在系统里」在存储和数据库两侧都成立：
 * 一直不给通过的评论会连同图一起到期消失，而正在审的（7 天内）不会被动。
 * 引用判定看评论正文里的 URL：wl_comment 只有 `comment` 一列（渲染后的 HTML），
 * 后台列表见到的 `orig` 是 Waline 运行时算出来的，库里没有。
 *
 * 调用方有两处：
 *   - `app/api/comment-image/route.ts`：每次上传成功后惰性触发（6 小时最多一次）
 *   - `app/api/comment-image/gc/route.ts`：手动强制清理
 */

/** 少于这个时长的对象一律不动：给「正在写评论」的访客留足时间 */
export const MIN_AGE_HOURS = 24
/** 只被「待审 / 垃圾」评论引用的图，超过这么久就回收（给审核留一周缓冲） */
export const UNAPPROVED_AGE_HOURS = 24 * 7
/** 评论正文里引用配图的形态：…/object/public/<bucket>/comments/YYYY/MM/<uuid>.<ext> */
const KEY_PATTERN = /comments\/\d{4}\/\d{2}\/[0-9a-fA-F-]{36}\.(?:jpg|png|webp|gif)/g

export type GcResult = {
  scanned: number
  referenced: number
  /** 本次删除的过期未通过评论记录数（含其回复子树） */
  purgedComments: number
  candidates: number
  deleted: number
  /** 超过单批上限没删完的数量，下次调用继续 */
  remaining: number
}

/** 一张图被哪些状态的评论引用过 */
type RefInfo = {
  /** 有没有任何一条**已通过**的评论引用它 */
  approved: boolean
  /** 最近一次被引用的时间（ms），用于判断「是不是刚传的」 */
  latest: number
}

/** 建连接执行一段逻辑，结束后必定关闭 */
async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const plan = resolvePgTls({
    connectionString: process.env.POSTGRES_URL,
    insecure: process.env.PG_SSL_INSECURE === '1',
    caFile: process.env.SUPABASE_CA_FILE,
    localSsl: process.env.PG_LOCAL_SSL === '1',
  })
  if (!plan.connectionString) throw new Error('未配置 POSTGRES_URL，无法访问评论库')

  const client = new Client({
    connectionString: plan.connectionString,
    ...(plan.ssl !== undefined ? { ssl: plan.ssl } : {}),
  })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

/**
 * 删除过期且未通过审核的评论记录（连同它们的整棵回复子树）。
 *
 * 用递归 CTE 一次性搞定：种子是「非 approved 且早于阈值」，再沿着 pid 往下捞所有后代。
 * 为什么不走 Waline 的 DELETE API：那是逐条 HTTP + hook + 通知，清几十条要几十个来回；
 * 而这里只是清垃圾，不需要触发那些副作用。
 *
 * ⚠️ 子回复会被一起删 —— 包括极罕见的「待审父 + 已通过子」（正常流程下不会出现，
 * 因为子能被通过说明父也审过了）。宁可整条线程一起清，也不要留下指向不存在父级的孤儿回复。
 *
 * @returns 实际删除的行数
 */
async function purgeStaleComments(
  client: Client,
  prefix: string,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const { rowCount } = await client.query(
    // 种子那一段必须套括号：Postgres 不允许 UNION 的一侧直接挂 LIMIT
    `WITH RECURSIVE doomed AS (
       (SELECT id FROM "${prefix}comment"
         WHERE status <> 'approved' AND insertedat < $1
         LIMIT $2)
       UNION
       SELECT c.id FROM "${prefix}comment" c
         INNER JOIN doomed d ON c.pid = d.id
     )
     DELETE FROM "${prefix}comment" WHERE id IN (SELECT id FROM doomed)`,
    [cutoff, limit],
  )
  return rowCount ?? 0
}

async function collectReferences(client: Client, prefix: string): Promise<Map<string, RefInfo>> {
  const { rows } = await client.query<{
    comment: string | null
    status: string | null
    insertedat: Date | null
  }>(`SELECT comment, status, insertedat FROM "${prefix}comment" WHERE comment LIKE '%/comments/%'`)

  const refs = new Map<string, RefInfo>()
  for (const row of rows) {
    if (!row.comment) continue
    const found = row.comment.match(KEY_PATTERN)
    if (!found) continue
    const at = row.insertedat ? row.insertedat.getTime() : 0
    const isApproved = row.status === 'approved'
    for (const key of found) {
      const prev = refs.get(key)
      refs.set(key, {
        approved: (prev?.approved ?? false) || isApproved,
        latest: Math.max(prev?.latest ?? 0, at),
      })
    }
  }
  return refs
}

/**
 * 跑一次回收。
 *
 * 先清评论记录（未通过 + 超期），再清图片：这样刚被删掉的评论引用的图会立刻变成
 * 「无人引用」，只要它也过了 24 小时就能一并清掉，不用等下一轮。
 *
 * @param maxDeletes 单次最多删多少张图（S3 DeleteObjects 上限 1000；自动触发时给小值控制耗时）
 */
export async function runCommentImageGc(options: { maxDeletes?: number } = {}): Promise<GcResult> {
  const maxDeletes = Math.min(options.maxDeletes ?? 500, 1000)
  const { endpoint, bucket, accessKeyId, secretAccessKey, ready } = resolveStorageConfig()
  if (!ready || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('对象存储未配置')
  }

  const prefix = process.env.POSTGRES_PREFIX ?? 'wl_'
  const unapprovedCutoff = new Date(Date.now() - UNAPPROVED_AGE_HOURS * 60 * 60 * 1000)

  // 评论记录与图片引用要在同一个连接里连续做完，避免两次建连
  const { refs, purgedComments } = await withDb(async (client) => {
    const purged = await purgeStaleComments(client, prefix, unapprovedCutoff, 50)
    const references = await collectReferences(client, prefix)
    return { refs: references, purgedComments: purged }
  })

  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })

  const objects: Array<{ Key: string; LastModified?: Date }> = []
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'comments/', ContinuationToken: token }),
    )
    for (const item of page.Contents ?? []) {
      if (item.Key) objects.push({ Key: item.Key, LastModified: item.LastModified })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  const now = Date.now()
  const orphanCutoff = now - MIN_AGE_HOURS * 60 * 60 * 1000
  const unapprovedCutoffMs = unapprovedCutoff.getTime()

  const stale = objects.filter((o) => {
    if (!o.LastModified) return false
    const modified = o.LastModified.getTime()
    const ref = refs.get(o.Key)
    if (!ref) return modified < orphanCutoff
    if (!ref.approved) return modified < unapprovedCutoffMs && ref.latest < unapprovedCutoffMs
    return false
  })

  const toDelete = stale.slice(0, maxDeletes)
  let deleted = 0
  if (toDelete.length) {
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: toDelete.map((o) => ({ Key: o.Key })), Quiet: true },
      }),
    )
    deleted = toDelete.length - (res.Errors?.length ?? 0)
    if (res.Errors?.length) console.error('[comment-image/gc] 部分删除失败:', res.Errors.slice(0, 5))
  }

  return {
    scanned: objects.length,
    referenced: refs.size,
    purgedComments,
    candidates: stale.length,
    deleted,
    remaining: Math.max(0, stale.length - toDelete.length),
  }
}

/**
 * 惰性触发回收（节流 + 不阻塞当前请求）。
 *
 * 为什么不做定时任务：EdgeOne 是函数容器，没有常驻进程。挂在「有人上传配图」和
 * 「有人发评论」这两条路径上最省事 —— 垃圾评论正是这两类流量带来的，来一个就顺手清一次。
 *
 * 6 小时最多跑一次、每次最多删 100 张图 / 50 条评论，避免把业务请求拖慢。
 * 用 `after()` 排到响应之后执行，平台会等它跑完；不支持的运行时降级成不等待。
 */
const LAZY_GC_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastLazyGcAt = 0
let lazyGcRunning = false

export function scheduleLazyGc(): void {
  const now = Date.now()
  if (lazyGcRunning || now - lastLazyGcAt < LAZY_GC_INTERVAL_MS) return
  lazyGcRunning = true
  lastLazyGcAt = now

  const job = () =>
    runCommentImageGc({ maxDeletes: 100 })
      .then((result) => {
        if (result.deleted || result.purgedComments) {
          console.log('[comment-gc] 自动回收完成:', result)
        }
      })
      .catch((error) => console.error('[comment-gc] 自动回收失败:', error))
      .finally(() => {
        lazyGcRunning = false
      })

  try {
    // 动态引入：after 只在 Next 请求上下文里存在，脚本环境调用会抛错
    void import('next/server')
      .then(({ after }) => after(job))
      .catch(() => job())
  } catch {
    void job()
  }
}
