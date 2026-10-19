import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { MIN_AGE_HOURS, UNAPPROVED_AGE_HOURS, runCommentImageGc } from '../../../../lib/comment-image-gc'

/**
 * 评论配图回收的**手动入口**。
 *
 * POST /api/comment-image/gc      header: x-gc-token: <HEALTH_TOKEN>
 *
 * 正常情况下不需要手动跑：每次访客上传配图，上传路由会惰性触发一次回收
 * （6 小时最多一次，每次最多删 100 个），所以有流量就会自己清。
 * 这个端点留着是为了「想立刻清一次」或者排查问题时用。
 *
 * 生产环境守卫：没配 HEALTH_TOKEN 就 404 —— 不给匿名调用者留删除入口。
 * 注意这不影响自动回收，那条路径不经过这里。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, 'utf-8')
  const bb = Buffer.from(b, 'utf-8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const expected = process.env.HEALTH_TOKEN
    const provided = request.headers.get('x-gc-token')
    if (!expected || !provided || !safeEqual(provided, expected)) {
      return new NextResponse('Not Found', { status: 404 })
    }
  }

  try {
    const result = await runCommentImageGc()
    return NextResponse.json(
      { ok: true, ...result, orphanAgeHours: MIN_AGE_HOURS, unapprovedAgeHours: UNAPPROVED_AGE_HOURS },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[comment-image/gc] 失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '回收失败' },
      { status: 502 },
    )
  }
}
