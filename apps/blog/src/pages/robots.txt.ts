import { absoluteUrl } from '../lib/posts';

/**
 * robots.txt 生成
 *
 * 覆盖策略：
 * - 允许爬虫抓取所有前台页面（Astro 生成的静态内容）
 * - 禁止抓取 /admin/、/api/、/_next/ 等后端/内部路径，避免 CMS 登录页和 API 端点被索引
 * - 禁止抓取 /__blog/（Astro 构建中间目录，正常情况下不可访问但做防御性配置）
 * - 声明 Sitemap 便于搜索引擎快速发现新页面
 */
export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /_next/',
    'Disallow: /__blog/',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
