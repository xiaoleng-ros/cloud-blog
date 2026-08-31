import type { GlobalConfig } from 'payload'

/** 导航管理（单例）：配置前台顶部导航菜单（对应从前 SiteSettings.navItems 拆出） */
export const Navigation: GlobalConfig = {
  slug: 'navigation',
  label: '导航管理',
  access: {
    read: () => true,
    update: () => true,
  },
  admin: {
    description: '配置前台顶部导航菜单（支持增删、排序）。',
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
        components: {
          // 使用可视化卡片列表替代纯文本 textarea
          Field: '/src/admin/components/NavItemsField.tsx#NavItemsField',
        },
      },
    },
  ],
}