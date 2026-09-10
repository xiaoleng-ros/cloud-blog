import type { CollectionConfig } from 'payload'

/** 管理员用户集合（用于登录后台） */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true, // 开启鉴权：提供用户名、密码、token
  admin: {
    useAsTitle: 'email',
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
  ],
}