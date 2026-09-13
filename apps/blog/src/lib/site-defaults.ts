/**
 * 站点默认值（后台 SiteSettings 缺失时兜底）。
 * 原 data/site.config.json 已移除，所有默认值统一在此维护。
 * 后台 SiteSettings 可覆盖这些值；前台运行时数据同步也从此取兜底。
 */
export const SITE_DEFAULTS = {
  siteName: '云岫的博客',
  siteDescription: '记录 AI、代码、网站搭建和技术观察。',
  siteAuthor: '段枫',
  siteUrl: import.meta.env.SITE_URL ?? 'https://example.com',
} as const
