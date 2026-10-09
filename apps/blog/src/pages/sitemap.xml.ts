import { getCollection } from 'astro:content';
import {
  getArchivePagePath,
  getArchiveTotalPages,
} from 'cloud-blog/shared/post-utils';
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
// 类型别名：避免 typeof X[number] 在编译后残留为运行时表达式（会报 ReferenceError: number is not defined）
type Changefreq = (typeof CHANGE_FREQS)[number];
// 运行时校验集合（避免 as unknown as readonly string[] 二次断言）
const CHANGE_FREQ_SET: ReadonlySet<string> = new Set(CHANGE_FREQS);
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 1;

const escapeXml = (value: string) =>
  value
    // XML 1.0 非法控制字符（\x08 等）会让整份 sitemap 解析失败，实体替换前先剥掉
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

// urlEntry 参数：除 url 外还支持 lastmod / changefreq / priority
interface UrlEntryOptions {
  lastmod?: Date;
  changefreq?: Changefreq;
  priority?: number;
}

// 生成一个 <url> 节点；priority 越界会被裁剪到 [0,1]，非法值直接忽略
const urlEntry = (path: string, options: UrlEntryOptions = {}) => {
  const { lastmod, changefreq, priority } = options;
  const safePriority =
    typeof priority === 'number'
      ? Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, priority))
      : null;
  const validChangefreq = changefreq && CHANGE_FREQ_SET.has(changefreq) ? changefreq : null;

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
    // 归档分页：首页之后每一页都要列出，否则第 2 页起在搜索引擎里是孤立页
    ...Array.from({ length: getArchiveTotalPages(posts.length) }, (_, index) =>
      urlEntry(getArchivePagePath(index + 1), { changefreq: 'yearly', priority: 0.3 }),
    ),
    // 笔记 / 关于
    urlEntry('/notes/', { changefreq: 'yearly', priority: 0.3 }),
    urlEntry('/about/', { changefreq: 'yearly', priority: 0.3 }),
    // 统计页：内容随文章增减而变，权重介于集合页与归档之间
    urlEntry('/stats/', { changefreq: 'weekly', priority: 0.5 }),
    // 标签墙：所有标签的入口页，本身不带正文，权重略低于单个标签页
    urlEntry('/tags/', { changefreq: 'weekly', priority: 0.5 }),
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
