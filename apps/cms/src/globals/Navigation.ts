import type { GlobalConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/**
 * 导航管理（单例）：配置前台顶部导航菜单与「更多」面板。
 *
 * 字段结构：
 * - topNav：顶部导航条标签（文字 + 链接 + 排序权重 + 前台可见）
 * - morePanel：「更多」下拉面板条目（标题 + 链接 + 图标 + 是否外链 + 排序权重 + 前台可见）
 *
 * 之前导航只支持顶部标签且用 textarea 存「文字 链接」，「更多」面板完全硬编码在前台代码里。
 * 现在两处都走结构化数组，后台可增删改，前台不再硬编码任何条目。
 */
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
    description: '配置前台顶部导航标签与「更多」面板条目（支持增删、排序、可见性）。',
    components: {
      views: {
        edit: {
          // root：整页替换内置编辑视图，与分类管理共用「列表 + 弹窗」版式
          root: {
            Component: '/src/admin/views/navigation/NavigationEditView.tsx#NavigationEditView',
          },
        },
      },
    },
  },
  fields: [
    {
      name: 'topNav',
      type: 'array',
      label: '顶部导航',
      labels: { singular: '导航项', plural: '导航项' },
      fields: [
        { name: 'label', type: 'text', required: true, label: '导航文字' },
        { name: 'href', type: 'text', required: true, label: '链接', admin: { description: '站内路径如 /archive，或外链如 https://...' } },
        { name: 'sort', type: 'number', defaultValue: 0, label: '排序权重', admin: { description: '数字越小越靠前' } },
        { name: 'visible', type: 'checkbox', defaultValue: true, label: '前台可见' },
      ],
    },
    {
      name: 'morePanel',
      type: 'array',
      label: '更多面板',
      labels: { singular: '条目', plural: '条目' },
      fields: [
        { name: 'label', type: 'text', required: true, label: '标题' },
        { name: 'href', type: 'text', required: true, label: '链接', admin: { description: '站内路径如 /stats，或外链如 https://...' } },
        { name: 'icon', type: 'text', label: '图标', admin: { description: '图标名，与前台 Icon 组件一致，如 github / tag / globe' } },
        { name: 'external', type: 'checkbox', defaultValue: false, label: '外链（新标签打开）' },
        { name: 'sort', type: 'number', defaultValue: 0, label: '排序权重', admin: { description: '数字越小越靠前' } },
        { name: 'visible', type: 'checkbox', defaultValue: true, label: '前台可见' },
      ],
    },
  ],
}
