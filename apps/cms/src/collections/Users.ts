import type { CollectionConfig } from 'payload'

/**
 * 后台管理员邮箱白名单（逗号分隔）。
 * 用于「谁能查看/管理其他账号」——本博客是单人后台，不引入额外的角色表，
 * 环境变量即最小可用的管理员判定。未配置时每个人只能读写自己的账号。
 */
const CMS_ADMINS = (process.env.CMS_ADMIN_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const isCmsAdmin = (user?: { email?: string } | null) =>
  !!user?.email && CMS_ADMINS.includes(user.email.toLowerCase())

/** 管理员用户集合（用于登录后台） */
export const Users: CollectionConfig = {
  slug: 'users',
  // 鉴权配置：
  // - 提供邮箱、密码、token（等同原 auth: true）
  // - useSessions: true（Payload 3 默认）：JWT 里的 sid 必须对应 user.sessions 中的真实会话，
  //   于是「改密码 / 后台删会话」能立即吊销已签发的令牌。
  //   历史教训：曾为了绕开 sid 校验显式关闭 sessions（飞书扫码自签 JWT 带不了合法 sid），
  //   结果是管理员令牌在有效期内完全不可吊销。现在飞书登录链路（src/app/api/feishu/callback）
  //   会先写入合法 session 再签名，因此无需关闭 sessions。
  // - requireCurrentPassword 不可用（Payload 3.88 无此项），且「忘记密码时用飞书扫码进来改密码」
  //   正是本集合的核心用途，不能要求旧密码。改为下方 beforeValidate 做服务端强度校验。
  auth: {
    useSessions: true,
    tokenExpiration: 86400, // 24h，配合可吊销会话进一步压缩存活期
  },
  access: {
    // 账号资料含 open_id 等登录凭据，默认只对本人可见；管理员白名单可查看全部
    read: ({ req }) => (isCmsAdmin(req.user) ? true : { id: { in: [req.user?.id ?? -1] } }),
    create: () => false, // 后台不提供自助注册，账号由管理员创建
    // 普通用户只能改自己；且 password 字段见下方 accessControl 限制
    update: ({ req }) => (isCmsAdmin(req.user) ? true : { id: { in: [req.user?.id ?? -1] } }),
    delete: ({ req }) => (isCmsAdmin(req.user) ? true : { id: { in: [req.user?.id ?? -1] } }),
    admin: ({ req }) => Boolean(req.user),
  },
  admin: {
    useAsTitle: 'email',
  },
  hooks: {
    // 服务端密码强度校验：账号页原先只在前端判「≥6 位」，绕过前端即可写入弱密码。
    beforeValidate: [
      ({ data }) => {
        const password = (data as { password?: unknown } | undefined)?.password
        if (password === undefined || password === null || password === '') return data
        if (typeof password !== 'string' || password.length < 8) {
          throw new Error('密码至少 8 位')
        }
        return data
      },
    ],
  },
  labels: {
    singular: '用户',
    plural: '用户',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: '昵称',
    },
    // 飞书扫码登录绑定字段：
    // - openId: 飞书租户内用户 ID（唯一），用于「扫码即登入」的账号识别
    // - unionId: 开发者应用维度内的跨租户唯一 ID（备用）
    // - name: 飞书里的用户姓名（便于后台识别「这是谁扫码登的」）
    // - avatar: 飞书头像 URL（可选，用于后台账号页展示）
    //
    // 使用方式：
    //   密码登录后访问 POST /api/feishu/bind 认领自己的 open_id，
    //   或在后台本字段直接填入自己的飞书 open_id；之后该 open_id 对应的飞书用户扫码即可登入本账号。
    {
      name: 'feishu',
      type: 'group',
      label: '飞书登录绑定',
      admin: {
        description:
          '飞书扫码登录时使用的账号绑定。填入你自己的飞书 open_id 后，即可通过飞书扫码登入本账号；忘记密码时用它兜底。',
      },
      fields: [
        {
          name: 'openId',
          type: 'text',
          label: 'Open ID',
          admin: {
            description: '飞书租户内的用户 ID（形如 ou_xxxxxxxxxx）',
          },
        },
        {
          name: 'unionId',
          type: 'text',
          label: 'Union ID',
        },
        {
          name: 'name',
          type: 'text',
          label: '飞书姓名',
        },
        {
          name: 'avatar',
          type: 'text',
          label: '飞书头像 URL',
        },
      ],
    },
  ],
}