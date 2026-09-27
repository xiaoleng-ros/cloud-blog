import type { CollectionEntry } from 'astro:content';
import { SITE_DEFAULTS } from './site-defaults';

// 通用文章工具函数从共享包重导出，保证前台各页面调用不变
export {
  formatDate,
  getPostCategory,
  getPostCover,
  getPostDescription,
  getPostExcerpt,
  getPostTags,
  getReadingMinutes,
  getAdjacentPosts,
  getRelatedPosts,
  getPostUpdatedDate,
  getCategories,
  getTags,
  getCategoryPath,
  getTagPath,
  getPostsByCategory,
  getPostsByTag,
  groupPostsByYear,
  sortPosts,
  sortPostsByDate,
} from 'cloud-blog/shared/post-utils';

export type BlogPost = CollectionEntry<'posts'>;

export const site = {
  name: SITE_DEFAULTS.siteName,
  author: SITE_DEFAULTS.siteAuthor,
  url: SITE_DEFAULTS.siteUrl,
  description: SITE_DEFAULTS.siteDescription,
};

/** 将相对路径转换为绝对 URL，便于 RSS / Sitemap / Open Graph 使用 */
export function absoluteUrl(path: string): string {
  return new URL(path, site.url).toString();
}

/** 从 post 上取分类名（data.categories 已归一为字符串数组，取第一个） */
function postCategoryName(post: BlogPost): string {
  const cats = post.data?.categories;
  if (Array.isArray(cats) && cats.length > 0) return String(cats[0]);
  return 'uncategorized';
}

/** 文章链接：/posts/{分类名}/{数字ID}/ */
export function getPostPath(post: BlogPost) {
  return `/posts/${encodeURIComponent(postCategoryName(post))}/${String(post.id)}/`;
}

/** 文章绝对 URL */
export function getPostUrl(post: BlogPost) {
  return absoluteUrl(getPostPath(post));
}
