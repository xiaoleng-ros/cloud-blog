/**
 * 站点默认值（后台 SiteSettings 缺失时兜底）。
 * 原 data/site.config.json 已移除，所有默认值统一在此维护。
 * 后台 SiteSettings 可覆盖这些值；前台运行时数据同步也从此取兜底。
 *
 * siteUrl 与 astro.config 的 site 同源：astro.config 用 loadEnv 解析 SITE_URL 后
 * 经 vite.define 注入 import.meta.env.SITE_URL，构建缺 SITE_URL 时直接报错，
 * 因此这里的兜底值只在无配置环境（如单测）生效——绝不再回退 example.com 占位域名。
 */
export const SITE_DEFAULTS = {
  siteName: '云岫的博客',
  siteDescription: '记录 AI、代码、网站搭建和技术观察。',
  siteAuthor: '段枫',
  siteUrl: import.meta.env.SITE_URL || 'http://localhost:4321',
} as const
