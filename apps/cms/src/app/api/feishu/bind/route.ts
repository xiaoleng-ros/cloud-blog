import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { verifyRequestUser } from '../../../../lib/feishu-session'

/**
 * 飞书账号绑定管理（必须已登录）
 *
 *   GET    /api/feishu/bind —— 查看当前账号的绑定状态
 *   POST   /api/feishu/bind —— 把自己的 open_id 认领到当前账号
 *   DELETE /api/feishu/bind —— 解绑
 *
 * 为什么需要它：
 *   回调端原本有「首次扫码自动绑定到 FEISHU_ADMIN_EMAIL」的逻辑，等于任何人都能通过
 *   诱导管理员走完一次自己的授权流程来抢占管理员账号（配合缺失的 state 校验即成 CSRF 接管）。
 *   现在未绑定的 open_id 一律拒绝登录，绑定必须由**已登录的账号本人**发起。
 *
 * 获取自己 open_id 的方法：先用密码登录后台，再扫码一次 —— 回调会被拒（not_bound），
 * 但服务端日志已记录该次扫码的 open_id；或直接到飞书管理台查看成员 open_id。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 飞书 open_id 形态：ou_ + 字母数字 */
const OPEN_ID_RE = /^ou_[A-Za-z0-9]{10,64}$/

/**
 * 是否 Postgres 唯一约束冲突（SQLSTATE 23505）。
 * count→update 之间存在并发窗口，最终由迁移
 * 20261002_000000_add_users_feishu_open_id_unique 的部分唯一索引兜底；
 * 错误对象可能被 Payload 包装多层，沿 cause 链向下找。
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (e.code === '23505') return true
    if (typeof e.message === 'string' && /duplicate key value/i.test(e.message)) return true
    current = e.cause
  }
  return false
}

type FeishuBinding = {
  openId?: string | null
  unionId?: string | null
  name?: string | null
  avatar?: string | null
}

async function getDb() {
  return getPayload({ config })
}

/** 已登录校验 + 同源校验（写操作防 CSRF） */
async function authorize(request: Request) {
  const payload = await getDb()
  const user = await verifyRequestUser(request, payload)
  if (!user) {
    return {
      payload,
      user: null,
      rejection: NextResponse.json({ error: '未登录或会话已失效' }, { status: 401 }),
    } as const
  }

  const originHeader = request.headers.get('origin')
  if (originHeader && new URL(originHeader).origin !== new URL(request.url).origin) {
    return {
      payload,
      user: null,
      rejection: NextResponse.json({ error: '跨站请求被拒绝' }, { status: 403 }),
    } as const
  }

  return { payload, user, rejection: null } as const
}

export async function GET(request: Request) {
  const { user, rejection } = await authorize(request)
  if (rejection) return rejection

  const payload = await getDb()
  const doc = await payload.findByID({ collection: 'users', id: user!.id, depth: 0 })
  const feishu = ((doc as unknown as { feishu?: FeishuBinding }).feishu ?? {}) as FeishuBinding

  return NextResponse.json(
    { bound: Boolean(feishu.openId), openId: feishu.openId ?? null, name: feishu.name ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  const { payload, user, rejection } = await authorize(request)
  if (rejection) return rejection

  let body: { openId?: string; unionId?: string; name?: string; avatar?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON' }, { status: 400 })
  }

  const openId = (body.openId ?? '').trim()
  if (!OPEN_ID_RE.test(openId)) {
    return NextResponse.json(
      { error: 'openId 格式非法（应形如 ou_xxxxxxxxxxxxxxxx）' },
      { status: 400 },
    )
  }

  // 一个 open_id 只能属于一个账号，否则两个账号互为提权入口。
  // count→update 不是原子的：这里的查重复只是给出更早、更友好的提示，
  // 真正的并发兜底是 users.feishu_open_id 的部分唯一索引（见 20261002 迁移）。
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: { 'feishu.openId': { equals: openId } },
  })
  if (totalDocs > 0) {
    return NextResponse.json({ error: '该飞书账号已绑定到其他用户' }, { status: 409 })
  }

  try {
    await payload.update({
      collection: 'users',
      id: user!.id,
      data: {
        feishu: {
          openId,
          unionId: (body.unionId ?? '').trim() || undefined,
          name: (body.name ?? '').trim() || undefined,
          avatar: (body.avatar ?? '').trim() || undefined,
        },
      } as never,
    })
  } catch (err) {
    // 并发窗口撞了唯一索引：转成可读的 400，不回显原始数据库错误
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: '该飞书账号刚刚已被其他用户绑定，请勿重复绑定' },
        { status: 400 },
      )
    }
    throw err
  }

  return NextResponse.json({ bound: true, openId }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: Request) {
  const { payload, user, rejection } = await authorize(request)
  if (rejection) return rejection

  await payload.update({
    collection: 'users',
    id: user!.id,
    data: { feishu: { openId: null, unionId: null, name: null, avatar: null } } as never,
  })

  return NextResponse.json({ bound: false }, { headers: { 'Cache-Control': 'no-store' } })
}
