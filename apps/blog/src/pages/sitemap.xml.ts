import { getCollection } from 'astro:content';
import {
  absoluteUrl,
  getCategories,
  getCategoryPath,
  getPostPath,
  getPostUpdatedDate,
  getTags,
  getTagPath,
  sortPosts,
} from '../lib/posts';

// Sitemap 允许的值集合（Google 官方要求小写、无空格、无引号）
// 用联合类型约束调用方，避免拼写错误进入 sitemap
const CHANGE_FREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const;
const CHANGE_FREQ_TYPE = typeof CHANGE_FREQS[number];
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 1;

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

// urlEntry 参数：除 url 外还支持 lastmod / changefreq / priority
interface UrlEntryOptions {
  lastmod?: Date;
  changefreq?: CHANGE_FREQ_TYPE;
  priority?: number;
}

// 生成一个 <url> 节点；priority 越界会被裁剪到 [0,1]，非法值直接忽略
const urlEntry = (path: string, options: UrlEntryOptions = {}) => {
  const { lastmod, changefreq, priority } = options;
  const safePriority =
    typeof priority === 'number'
      ? Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, priority))
      : null;
  const validChangefreq = changefreq && (CHANGE_FREQS as readonly string[]).includes(changefreq)
    ? changefreq
    : null;

  return `
  <url>
    <loc>${escapeXml(absoluteUrl(path))}</loc>
    ${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}
    ${validChangefreq ? `<changefreq>${validChangefreq}</changefreq>` : ''}
    ${safePriority !== null ? `<priority>${safePriority.toFixed(1)}</priority>` : ''}
  </url>`;
};

// 各类页面的变更频率与权重约定（按 SEO 通用经验）：
// - 首页：daily / 1.0
// - 文章：monthly / 0.6（正文更新不频繁，权重中等）
// - 分类 / 标签：weekly / 0.7（内容集合页，权重高于单篇）
// - 归档 / 关于：yearly / 0.3（几乎不变更，权重低）
// - 搜索：never / 0.2（对搜索引擎价值低）
export async function GET() {
  const posts = sortPosts(await getCollection('posts'));
  const categories = getCategories(posts);
  const tags = getTags(posts);

  const paths = [
    // 首页
    urlEntry('/', { changefreq: 'daily', priority: 1.0 }),
    // 分类页
    ...categories.map((category) =>
      urlEntry(getCategoryPath(category.name), {
        changefreq: 'weekly',
        priority: 0.7,
      }),
    ),
    // 标签页
    ...tags.map((tag) =>
      urlEntry(getTagPath(tag.name), { changefreq: 'weekly', priority: 0.7 }),
    ),
    // 文章页
    ...posts.map((post) =>
      urlEntry(getPostPath(post), {
        lastmod: getPostUpdatedDate(post),
        changefreq: 'monthly',
        priority: 0.6,
      }),
    ),
    // 归档 / 笔记 / 关于
    urlEntry('/archive/', { changefreq: 'yearly', priority: 0.3 }),
    urlEntry('/notes/', { changefreq: 'yearly', priority: 0.3 }),
    urlEntry('/about/', { changefreq: 'yearly', priority: 0.3 }),
    // 搜索页：对搜索引擎价值低
    urlEntry('/search/', { changefreq: 'never', priority: 0.2 }),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.join('')}
</urlset>`;

  return new Response(body.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
