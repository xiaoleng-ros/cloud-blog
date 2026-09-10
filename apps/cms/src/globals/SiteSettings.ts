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
            { name: 'aboutLead', type: 'text', label: '关于页大标题', admin: { width: '50%' } },
            {
              name: 'aboutParagraphs',
              type: 'textarea',
              label: '关于页正文',
              admin: {
                rows: 6,
                description:
                  '每个段落一行。可使用简单 HTML，如 <span class="marker-highlight">高亮</span> 来给部分文字加高亮标记。',
              },
            },
            {
              name: 'aboutNotes',
              type: 'textarea',
              label: '关于页便签',
              admin: {
                rows: 4,
                description: '每行一条「标题｜副文字｜颜色」，颜色可选 yellow / cyan / pink。',
              },
            },
            {
              name: 'skills',
              type: 'textarea',
              label: '技能环',
              admin: {
                rows: 6,
                description: '每行一条「名称｜副标题｜数值｜颜色」，数值 0-100，颜色可选 yellow / cyan / pink / purple。',
              },
            },
          ],
        },
      ],
    },
  ],
}
