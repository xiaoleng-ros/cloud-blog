import type { CollectionConfig } from 'payload'
import { publishedOnlyForAnonymous } from '../lib/access'
import { syncInvalidateHook } from '../lib/sync-cache'
import { isSafeHref } from 'cloud-blog/shared/html-safety'

/**
 * 站点地址校验：只收 http(s) 绝对地址。
 *
 * 与 Projects 的 validateHref 不同 —— 友链要渲染成 `<a href>` 且带 target=_blank，
 * mailto:/tel: 当友链没有意义，站内相对路径更不行（友链就是别人的站）。
 * `javascript:`/`data:` 这类协议在入库这一层就挡掉，前台两条渲染链路另有白名单兜底。
 */
const validateSiteUrl = (value?: string | null) => {
  if (!value) return '请填写站点地址'
  if (!isSafeHref(value)) return '链接协议不被允许，请填写 http(s) 开头的完整地址'
  if (!/^https?:\/\//i.test(value)) return '请填写 http(s) 开头的完整地址，例如 https://example.com'
  return true
}

/** 头像地址校验：允许留空；填了就必须是 http(s)（前端 <img src> 同样过白名单） */
const validateAvatar = (value?: string | null) => {
  if (!value) return true
  if (!isSafeHref(value)) return '头像地址协议不被允许，请填写 http(s) 开头的图片地址'
  if (!/^https?:\/\//i.test(value)) return '头像请填写 http(s) 开头的完整地址'
  return true
}

/**
 * 友链集合
 *
 * 一条记录 = 一张友链卡片。前台 /friends 按 group 聚合成区块，
 * 与「关于页项目区」（Projects）完全同一套组织方式，视觉与数据口径都对齐。
 *
 * ==================== 审核流 ====================
 *
 * status 四态：
 *   pending   访客提交、尚未处理（公开申请接口写入的初始值）
 *   published 已通过 —— **唯一**会对匿名前台展示的状态
 *   rejected  已拒绝（保留记录，方便下次同一个人再申请时查历史）
 *   hidden    已通过但暂时不展示（对方站点长期打不开时用，比删掉可追溯）
 *
 * 前台只经两条链路读数据：REST /api/friends（access 过滤）与同步层 fetchFriends，
 * 两者都用 published，不会漏。
 *
 * ==================== 为什么不给匿名 create ====================
 *
 * 申请走 /api/friend-apply（自定义 route）而不是直接 POST /api/friends。
 * 若在这里放开匿名 create，任何人都能直接写任意 status —— 包括 published，
 * 等于自助上首页。自定义 route 里固定 status='pending' 并做限流/去重，
 * 集合本身的 create 只留给后台登录用户。
 */
export const Friends: CollectionConfig = {
  slug: 'friends',
  // 后台列表默认按 sortOrder 升序：站长手动调整的数字即前台展示顺序
  defaultSort: 'sortOrder',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'url', 'group', 'sortOrder', 'status', 'source', 'updatedAt'],
    description:
      '友链卡片。前台 /friends 把所有「已通过」的友链平铺成卡片墙（不分组），按排序值升序展示。',
    // 待审核的申请最需要被看见，列表页把 pending 排前面由 sortOrder 决定不了，
    // 这里给一个默认筛选提示（Payload 没有原生的「默认按状态筛选」配置项）
    listSearchableFields: ['name', 'url', 'description'],
    components: {
      // 定制卡片列表页：搜索 + 状态页签 + 卡片网格，审核动作直接在卡片上完成
      views: {
        list: {
          Component: '/src/admin/views/friends/FriendsListView.tsx#FriendsListView',
        },
      },
    },
  },
  labels: {
    singular: '友链',
    plural: '友链',
  },
  access: {
    // 匿名只能读 published（pending/rejected/hidden 一律不可见）
    read: publishedOnlyForAnonymous(),
    // create/update/delete 保持 Payload 默认：仅登录的后台用户。
    // 访客申请由 app/api/friend-apply 用 overrideAccess 写入。
  },
  hooks: {
    // 后台增删改后清同步快照与区块缓存，前台下一次轮询即生效
    afterChange: [syncInvalidateHook],
    afterDelete: [syncInvalidateHook],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: '站点名称',
      admin: { description: '卡片上显示的名字，如「纸鹿摸鱼处」。' },
    },
    {
      name: 'url',
      type: 'text',
      required: true,
      unique: true,
      label: '站点地址',
      validate: validateSiteUrl,
      admin: { description: '必须是 http(s) 开头的完整地址。唯一约束：同一个地址不能重复添加。' },
    },
    {
      name: 'description',
      type: 'textarea',
      label: '一句话描述',
      maxLength: 120,
      admin: { description: '卡片正面显示的副标题，建议 30 字以内，超过会被 CSS 截断。' },
    },
    {
      name: 'avatar',
      type: 'text',
      label: '头像地址',
      validate: validateAvatar,
      admin: {
        description: '外链图片地址（建议方形，200×200 以上）。留空时前台用站点名首字兜底。',
      },
    },
    {
      name: 'group',
      type: 'text',
      required: true,
      defaultValue: '朋友们',
      label: '分组名称',
      admin: {
        position: 'sidebar',
        description:
          '⚠️ 当前前台**不分组**：所有友链平铺成一个网格，这个字段暂时不生效。' +
          '保留它是为了将来想分区时不用改数据。',
      },
    },
    {
      name: 'groupDescription',
      type: 'textarea',
      label: '分组描述',
      admin: {
        position: 'sidebar',
        description: '⚠️ 当前前台不分组，此字段暂不生效（原因同上）。',
      },
    },
    {
      name: 'note',
      type: 'text',
      label: '站长备注',
      maxLength: 120,
      admin: { description: '卡片悬停时显示的私货，如「我是看着这位的视频搭起来的第一个博客」。' },
    },
    {
      name: 'sortOrder',
      type: 'number',
      label: '排序值',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: '数字越小越靠前。同组内按这个值升序排列。',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      label: '状态',
      options: [
        { label: '待审核', value: 'pending' },
        { label: '已通过', value: 'published' },
        { label: '已拒绝', value: 'rejected' },
        { label: '已隐藏', value: 'hidden' },
      ],
      admin: {
        position: 'sidebar',
        description: '只有「已通过」会出现在前台。',
      },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'manual',
      label: '来源',
      options: [
        { label: '手动添加', value: 'manual' },
        { label: '访客申请', value: 'apply' },
      ],
      admin: {
        position: 'sidebar',
        description: '访客经申请接口提交的会自动标记为「访客申请」，方便筛出待审队列。',
      },
    },
    {
      name: 'email',
      type: 'email',
      label: '联系邮箱',
      /**
       * 字段级读权限：只有登录用户（后台）能读到。
       *
       * 集合的 read access 只管「能不能读这条文档」，不管「能读哪些字段」——
       * 匿名访问 /api/friends 时整条文档会被完整序列化，邮箱/留言/提交 IP 都会漏出去。
       * 这三项都是运营信息，必须在字段这一层再挡一次。
       */
      access: { read: ({ req }) => Boolean(req.user) },
      admin: {
        position: 'sidebar',
        description: '仅后台可见，前台任何接口都不会返回。对方站点失联时联系用。',
      },
    },
    {
      name: 'message',
      type: 'textarea',
      label: '申请留言',
      maxLength: 300,
      access: { read: ({ req }) => Boolean(req.user) },
      admin: {
        description: '访客提交时填的留言，仅后台可见。',
      },
    },
    {
      name: 'submitIp',
      type: 'text',
      label: '提交 IP',
      access: { read: ({ req }) => Boolean(req.user) },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: '申请接口自动记录，用于识别刷单/同源重复提交。',
      },
    },
  ],
}
