import type { GlobalConfig } from 'payload'

/** 站点设置（单例）：收纳前台 site.config.json、Hero、社交、歌单等配置（导航已拆到 Navigation） */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: '站点设置',
  access: {
    read: () => true,
    update: () => true,
  },
  admin: {
    description: '管理站点基本信息、首页 Hero 与社交链接。导航请到「导航管理」。',
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
            {
              type: 'row',
              fields: [
                { name: 'twikooEnvId', type: 'text', label: 'Twikoo 评论服务地址', admin: { width: '50%' } },
                { name: 'neteasePlaylistId', type: 'text', label: '网易云歌单 ID', admin: { width: '50%' } },
              ],
            },
            { name: 'siteDescription', type: 'textarea', label: '站点简介' },
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
            { name: 'buttonLabel', type: 'text', label: '浏览文章按钮文字', admin: { width: '50%' } },
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
      ],
    },
  ],
}
