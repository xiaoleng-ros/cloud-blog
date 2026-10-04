import { getCollection } from 'astro:content';
import {
  absoluteUrl,
  getPostDescription,
  getPostUpdatedDate,
  getPostUrl,
  site,
  sortPosts,
} from '../lib/posts';
import { getSiteSettings } from '../lib/site-settings';

const escapeXml = (value: string) =>
  value
    // XML 1.0 非法控制字符（\x08 等）会让整份 feed 解析失败，实体替换前先剥掉
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export async function GET() {
  // 站点名/作者/描述：构建期取一次后台 SiteSettings，失败（null）回退 SITE_DEFAULTS；RSS 限最近 50 条
  const settings = await getSiteSettings();
  const siteName = settings?.siteName ?? site.name;
  const siteAuthor = settings?.siteAuthor ?? site.author;
  const siteDescription = settings?.siteDescription ?? site.description;
  const posts = sortPosts(await getCollection('posts')).slice(0, 50);
  const latestDate = posts
    .map(getPostUpdatedDate)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // 站点作者：Feedly / NetNewsWire 等客户端识别 author 时需要 email，用 site.url 派生的伪 email 兜底
  const authorEmail = 'noreply@' + new URL(site.url).hostname;

  const items = posts
    .map((post) => {
      const url = getPostUrl(post);
      const date = getPostUpdatedDate(post);
      const postAuthor = post.data.author ?? siteAuthor;

      return `
        <item>
          <title>${escapeXml(post.data.title)}</title>
          <link>${escapeXml(url)}</link>
          <guid isPermaLink="true">${escapeXml(url)}</guid>
          ${date ? `<pubDate>${date.toUTCString()}</pubDate>` : ''}
          <description>${escapeXml(getPostDescription(post))}</description>
          <author>${escapeXml(`${postAuthor} (${authorEmail})`)}</author>
        </item>`;
    })
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)}</title>
    <link>${escapeXml(absoluteUrl('/'))}</link>
    <description>${escapeXml(siteDescription)}</description>
    <language>zh-CN</language>
    <generator>Astro</generator>
    <ttl>60</ttl>
    <managingEditor>${escapeXml(authorEmail)}</managingEditor>
    <webMaster>${escapeXml(authorEmail)}</webMaster>
    ${latestDate ? `<lastBuildDate>${latestDate.toUTCString()}</lastBuildDate>` : ''}
    ${items}
  </channel>
</rss>`;

  return new Response(body.trim(), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
