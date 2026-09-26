import { getCollection } from 'astro:content';
import {
  absoluteUrl,
  getPostDescription,
  getPostUpdatedDate,
  getPostUrl,
  site,
  sortPosts,
} from '../lib/posts';

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export async function GET() {
  const posts = sortPosts(await getCollection('posts'));
  const latestDate = posts
    .map(getPostUpdatedDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // 站点作者：Feedly / NetNewsWire 等客户端识别 author 时需要 email，用 site.url 派生的伪 email 兜底
  const authorEmail = 'noreply@' + new URL(site.url).hostname;

  const items = posts
    .map((post) => {
      const url = getPostUrl(post);
      const date = getPostUpdatedDate(post);
      const postAuthor = post.data.author ?? site.author;

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
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(absoluteUrl('/'))}</link>
    <description>${escapeXml(site.description)}</description>
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
