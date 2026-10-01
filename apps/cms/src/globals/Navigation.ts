import type { GlobalConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/** 导航管理（单例）：配置前台顶部导航菜单（对应从前 SiteSettings.navItems 拆出） */
export const Navigation: GlobalConfig = {
  slug: 'navigation',
  label: '导航管理',
  access: {
    read: () => true,
    // 仅登录用户可修改导航配置，防止未授权篡改
    update: ({ req }) => Boolean(req.user),
  },
  hooks: {
    afterChange: [syncInvalidateHook],
  },
  admin: {
    description: '配置前台顶部导航菜单（支持增删、排序）。',
    components: {
      views: {
        edit: {
          // root：整页替换内置编辑视图，与站点设置共用「卡片 + 底部保存」版式
          root: {
            Component: '/src/admin/views/navigation/NavigationEditView.tsx#NavigationEditView',
          },
        },
      },
    },
  },
  fields: [
    {
      type: 'textarea',
      name: 'navItems',
      label: '导航项',
      required: false,
      admin: {
        rows: 6,
        description: '每条一个「文字 链接」，一行一项，按从上到下顺序在前台顶部导航展示。',
      },
    },
  ],
}