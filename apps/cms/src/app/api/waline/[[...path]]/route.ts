import {
  createComment,
  deleteComment,
  getCounter,
  likeComment,
  listComments,
  commentCount,
  recentComments,
  updateComment,
  updateCounter,
  WalineServerError,
  ensureAdminAccount,
  normalizeComment,
  withDb,
  table,
} from '../../../../lib/waline-server'
import { scheduleLazyGc } from '../../../../lib/comment-image-gc'
import { lookupAddr as prefetchAddr } from '../../../../lib/comment-identity'
// IP 解析统一走 lib/client-ip：XFF 是追加式头部，取首段等于取攻击者自己填的值。
// 实测确认 EdgeOne 原样透传客户端发来的 XFF（伪造 `1.2.3.4, 203.0.113.9` 后库里存的就是
// `1.2.3.4`），所以必须从右往左取第一个合法 IP，否则换一个头就是一个新限流桶。
import { clientIp } from '../../../../lib/client-ip'

// 评论服务用 pg 直连，只能在 Node 运行时跑
export const runtime = 'nodejs'
// 每次都要实时读写，禁止静态化/缓存
export const dynamic = 'force-dynamic'

const ADMIN_EMAIL = 'cms-moderation@invalid.local'

/**
 * 鉴权：管理动作（改/删评论）必须来自**真实登录的后台会话**。
 *
 * ==================== 为什么重写这段 ====================
 *
 * 原实现用 `process.env.JWT_TOKEN` 验一个自带 Bearer 令牌，只验签、不查用户是否存在、
 * 也不查会话是否被吊销。三个问题叠在一起：
 *
 * 1. **签发端已经不存在**：全仓 grep 不到任何 `jwt.sign`/`mintAdminToken`（它只活在
 *    这条注释里），也就是说没人能合法产出这种令牌 —— 这个分支是死代码。
 * 2. **它是一个长期有效的后门**：只要有人从任何途径拿到 JWT_TOKEN（比如历史上
 *    泄露过的 .env、备份、日志），就能永久管理评论，且因为不查会话，改密码/删账号
 *    都吊销不掉它。而 payload 自己的会话令牌是 `useSessions` + 24h 过期的，能吊销。
 * 3. **依赖未声明**：`jsonwebtoken` 不在 apps/cms/package.json 里（靠传递依赖解析），
 *    上游少一个包就会在运行期崩。
 *
 * 现在改成与后台管理页完全同一条鉴权链：读 payload-token cookie → jose 验签 →
 * 查 users 集合 → 校验 sid 仍在有效会话列表里（`verifyRequestUser` 已经做了全部这些）。
 */
async function verifyAdminToken(request: Request): Promise<{ ok: boolean; userId?: number }> {
  // 没有 cookie 就没什么可验的，先短路避免无谓地实例化 Payload
  if (!request.headers.get('cookie')?.includes('token')) return { ok: false }
  try {
    const { getPayload } = await import('payload')
    const { default: config } = await import('@payload-config')
    const { verifyRequestUser } = await import('../../../../lib/feishu-session')
    const payload = await getPayload({ config })
    const user = await verifyRequestUser(request, payload)
    if (!user) return { ok: false }
    const id = Number(user.id)
    return Number.isFinite(id) ? { ok: true, userId: id } : { ok: true }
  } catch (err) {
    console.warn('[waline] 管理员鉴权失败', err instanceof Error ? err.message : err)
    return { ok: false }
  }
}

/** 统一信封：成功 errno=0，失败 errno=status */
function ok<T>(data: T, extra: Record<string, unknown> = {}): Response {
  return Response.json({ errno: 0, data, ...extra }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

function fail(err: unknown): Response {
  if (err instanceof WalineServerError) {
    return Response.json({ errno: err.status, errmsg: err.message }, { status: err.status })
  }
  console.error('[waline] 未捕获错误', err)
  return Response.json({ errno: 500, errmsg: '评论服务内部错误' }, { status: 500 })
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // 剥掉 /api/waline 前缀，得到 Waline 原生路径
  const stripped = url.pathname.replace(/^\/api\/waline/, '') || '/'
  const method = request.method.toUpperCase()
  const params = url.searchParams

  try {
    // ==================== 评论 ====================
    if (stripped === '/api/comment' && method === 'GET') {
      const type = params.get('type')
      // 评论数统计
      if (type === 'count') {
        const urls = (params.get('url') ?? '').split(',').filter(Boolean)
        const counts = await commentCount(urls)
        // 官方形状同样是数组，顺序与传入的 url 一致：
        //   qf: a.forEach((t,n)=>{t.textContent=e[n].toString()})
        return ok(urls.map((u) => counts[u] ?? 0))
      }
      // 最近评论
      if (type === 'recent') {
        // ⚠️ 必须钳制：count 直接当 SQL LIMIT 用，且每条结果都要过属地查询。
        // 未钳制时匿名请求 `?type=recent&count=1000000` 会拉全表 + 打爆
        // ip.zxinc.org 配额（lookupAddrs 单批预算 4s，超时后整批降级为空）。
        // 与下面 pageSize 的 Math.min 同口径。
        const count = Math.min(50, Math.max(1, Number(params.get('count') ?? 10) || 10))
        const data = await recentComments(count)
        return ok(data)
      }
      // 默认：文章评论列表
      const path = params.get('path') ?? ''
      const page = Number(params.get('page') ?? 1) || 1
      const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 10) || 10))
      const sortBy = (params.get('sortBy') ?? 'newest') as 'newest' | 'oldest' | 'hottest'
      const result = await listComments({ path, page, pageSize, sortBy })
      // ⚠️ 形状必须与官方 @waline/core 的 comment.list 返回值一致：**分页对象整体作为信封的 data**，
      // 评论数组再嵌在这个对象的 data 里。官方源码：
      //   return { page, totalPages: Math.ceil(rootCount / pageSize), pageSize, count: total, data }
      //   → rest.js runCore(..., { json: true }) → jsonOrSuccess(data) → { errno: 0, data: <上面那个对象> }
      //
      // 而 @waline/client 的 getComment() 是 `.then(e => n(e, 'Get comment data').data)`，
      // 只取信封的 data，组件再读 resp.count / resp.data / resp.totalPages。
      // 若把 count/totalPages 平铺到信封外层（曾经的做法），resp 会是数组，
      // 三个字段全 undefined → data.value.push(...undefined) 抛
      // "t.data is not iterable"，整个评论区渲染中断。
      return ok({
        page: result.page,
        totalPages: result.totalPages,
        pageSize,
        count: result.count,
        data: result.data,
      })
    }

    if (stripped === '/api/comment' && method === 'POST') {
      const body = (await request.json()) as Record<string, unknown>
      const auth = await verifyAdminToken(request)
      const created = await createComment(
        {
          comment: String(body.comment ?? ''),
          nick: String(body.nick ?? ''),
          mail: String(body.mail ?? ''),
          link: String(body.link ?? ''),
          url: String(body.url ?? ''),
          ua: String(body.ua ?? request.headers.get('user-agent') ?? ''),
          pid: body.pid ? Number(body.pid) : undefined,
          rid: body.rid ? Number(body.rid) : undefined,
          at: body.at ? String(body.at) : undefined,
        },
        { ip: clientIp(request), isAdmin: auth.ok, adminUserId: auth.userId },
      )
      // 访客评论成功 → 触发惰性图片回收（节流 6 小时）
      if (!auth.ok) scheduleLazyGc()
      return ok(created)
    }

    // PUT /api/comment/:id —— 管理员更新 / 访客点赞
    const updateMatch = stripped.match(/^\/api\/comment\/(\d+)$/)
    if (updateMatch && method === 'PUT') {
      const id = Number(updateMatch[1])
      const auth = await verifyAdminToken(request)
      const body = (await request.json()) as Record<string, unknown>
      // 点赞：body 里有 like 字段且非管理员
      if (body.like !== undefined && !auth.ok) {
        // 只接受明确的 +1 / -1，其余（NaN、字符串、0、999）一律按点赞处理。
        // 原实现用 `like < 0` 判方向，`{"like":"abc"}` 会走点赞分支而 `Number()` 得到
        // NaN —— 虽然这里的布尔判断不会把 NaN 传下去，但显式归一化更不容易被后续改动引偏。
        const raw = Number(body.like)
        const unlike = raw === -1 || raw < 0
        const newLike = await likeComment(id, unlike)
        return ok({ like: newLike })
      }
      // 管理员更新
      if (!auth.ok) {
        return Response.json({ errno: 403, errmsg: '无权操作' }, { status: 403 })
      }
      const updated = await updateComment(id, body)
      // normalizeComment 已不含 mail/ip/ua；管理员在这里只需看到更新后的内容，
      // 邮箱等后台字段走带鉴权的 /api/comments
      return ok({ ...normalizeComment(updated, await prefetchAddr(updated.ip)) })
    }

    // DELETE /api/comment/:id —— 管理员删除
    if (updateMatch && method === 'DELETE') {
      const id = Number(updateMatch[1])
      const auth = await verifyAdminToken(request)
      if (!auth.ok) {
        return Response.json({ errno: 403, errmsg: '无权操作' }, { status: 403 })
      }
      await deleteComment(id)
      return ok({ id })
    }

    // ==================== 计数（阅读量 / 反应） ====================
    //
    // ⚠️ 响应形状必须与官方 Waline 一致：data 是**数组**，按 paths 的顺序一一对应。
    // 官方客户端有三处消费点全部按下标取值，返回成「以路径为键的对象」会直接炸：
    //   ch=(e,t)=>{t.forEach((t,n)=>{let r=e[n].time;...})}          阅读量回填
    //   qf: t.textContent=e[n].toString()                            评论数
    //   reaction: let[s]=await i({...}) → s[`reaction${t}`]          对象解构会抛
    //             "(intermediate value) is not iterable"，整个评论区渲染中断。
    if (stripped === '/api/article' && method === 'GET') {
      // ⚠️ 必须限条数：这个分支对每个 path 串行发一次 getCounter（一次 DB 往返）。
      // 匿名请求 `?path=/a,/a,/a,...（一万个）` 原本会让单个请求打出一万次查询，
      // 直接把连接池占死 —— 一次 curl 就能拖垮全站评论与阅读量接口。
      // 官方客户端一次最多带一页的路径数（个位数），50 已经非常宽裕。
      const paths = (params.get('path') ?? '').split(',').filter(Boolean).slice(0, 50)
      const types = (params.get('type') ?? 'time').split(',').filter(Boolean).slice(0, 16)
      const result: Record<string, number>[] = []
      for (const p of paths) {
        const counter = await getCounter(p)
        const obj: Record<string, number> = {}
        for (const t of types) {
          if (t === 'time') obj.time = counter.time ?? 0
          else if (/^reaction[0-8]$/.test(t)) obj[t] = (counter as unknown as Record<string, number | null>)[t] ?? 0
        }
        result.push(obj)
      }
      return ok(result)
    }

    if (stripped === '/api/article' && method === 'POST') {
      const body = (await request.json()) as { path: string; type: string; action: string }
      const counter = await updateCounter(body.path, body.type, body.action)
      const obj: Record<string, number> = {}
      if (body.type === 'time') obj.time = counter.time ?? 0
      else if (/^reaction[0-8]$/.test(body.type)) {
        obj[body.type] = (counter as unknown as Record<string, number | null>)[body.type] ?? 0
      }
      // POST 的消费方是 ch(e, nodes)：传进来的 e 直接按数组用，这里同样给数组。
      return ok([obj])
    }

    // ==================== 健康检查 ====================
    if (stripped === '/' || stripped === '') {
      return Response.json({ errno: 0, data: { name: 'cloud-blog-waline', version: '2.0' } })
    }

    // 兜底：未匹配的路径返回 404
    return Response.json({ errno: 404, errmsg: 'Not Found' }, { status: 404 })
  } catch (err) {
    return fail(err)
  }
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
export const HEAD = handle
