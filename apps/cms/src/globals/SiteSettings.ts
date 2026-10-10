import type { GlobalConfig } from 'payload'
import { syncInvalidateHook } from '../lib/sync-cache'

/** 站点设置（单例）：收纳前台 site.config.json、Hero、社交、歌单等配置（导航已拆到 Navigation） */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: '站点设置',
  access: {
    read: () => true,
    // 仅登录用户可修改站点设置，防止未授权篡改
    update: ({ req }) => Boolean(req.user),
  },
  hooks: {
    afterChange: [syncInvalidateHook],
  },
  admin: {
    description: '管理站点基本信息、首页 Hero 与社交链接。导航请到「导航管理」。',
    components: {
      views: {
        edit: {
          // root：整页替换内置编辑视图（含标题/保存栏），左侧配置菜单 + 右侧内容面板
          root: {
            Component: '/src/admin/views/settings/SettingsEditView.tsx#SettingsEditView',
          },
        },
      },
    },
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '站点信息',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'siteName', type: 'text', label: '站点名称', required: true, admin: { width: '50%' } },
                { name: 'siteAuthor', type: 'text', label: '作者', admin: { width: '50%' } },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'githubUser', type: 'text', label: 'GitHub 用户名', admin: { width: '50%' } },
                { name: 'githubRepo', type: 'text', label: 'GitHub 仓库地址', admin: { width: '50%' } },
              ],
            },
            { name: 'neteasePlaylistId', type: 'text', label: '网易云歌单 ID', admin: { width: '50%' } },
            { name: 'siteDescription', type: 'textarea', label: '站点简介' },
          ],
        },
        {
          label: '网站配置',
          fields: [
            { name: 'siteIcon', type: 'text', label: '网站图标', admin: { description: '用作浏览器标签页图标与页脚头像；留空则用站点默认头像。' } },
            { name: 'siteIcp', type: 'text', label: 'ICP 备案号' },
            // 创建时间存 'YYYY-MM-DD' 文本而非 date：date 落库是带时区时间戳，
            // 跨时区读回会整体偏一天，而它只需要按年/按日原样展示。
            { name: 'siteCreatedAt', type: 'text', label: '网站创建时间' },
          ],
        },
        {
          label: '首页 Hero',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'greeting', type: 'text', label: '问候语', admin: { width: '50%' } },
                { name: 'name', type: 'text', label: '名字', admin: { width: '50%' } },
              ],
            },
            { name: 'subtitle', type: 'text', label: '副标题' },
            { name: 'bio', type: 'textarea', label: '介绍文字' },
          ],
        },
        {
          label: '社交链接',
          fields: [
            {
              name: 'socials',
              type: 'textarea',
              label: '社交链接',
              admin: {
                components: {
                  // 使用可视化卡片列表替代默认 textarea
                  Field: '/src/admin/components/SocialLinksField.tsx#SocialLinksField',
                },
              },
            },
          ],
        },
        {
          label: '页脚',
          fields: [
            { name: 'footerSubtitle', type: 'text', label: '页脚副标题', admin: { width: '50%' } },
            {
              name: 'footerChannels',
              type: 'textarea',
              label: '页脚链接',
              admin: {
                rows: 5,
                description:
                  '每行一条「名称 链接」。支持 Bilibili / YouTube / RSS 图标，其余名称按文字展示。链接以 http 开头用新标签打开。',
              },
            },
            {
              name: 'footerGroups',
              type: 'textarea',
              label: '页脚群组',
              admin: {
                rows: 4,
                description:
                  '每行一条「名称 链接」，链接可留空仅填名称（展示为纯文字标签）。支持 QQ / 微信图标。',
              },
            },
          ],
        },
        {
          label: '关于页',
          fields: [
            {
              name: 'aboutParagraphs',
              type: 'textarea',
              label: '关于页正文',
              admin: {
                rows: 6,
                description:
                  '一行一段，想换行直接回车；给部分文字加高亮写成 ==这样== 即可（旧数据里的 HTML 会在后台首次保存时自动转成该记号）。',
              },
            },
            {
              name: 'aboutNotes',
              type: 'textarea',
              label: '关于页便签',
              admin: {
                rows: 4,
                description:
                  '后台由行编辑器管理：JSON 数组，兼容旧「标题|副文字|颜色」行文本。颜色 = 预设 token（yellow/cyan/pink/green/purple）或任意 hex。',
              },
            },
            {
              name: 'skills',
              type: 'textarea',
              label: '技能环',
              admin: {
                rows: 6,
                description:
                  '后台由行编辑器管理：JSON 数组，兼容旧「名称|副标题|数值|颜色」行文本。数值 0-100，颜色同上可任选。',
              },
            },
          ],
        },
      ],
    },
  ],
}
