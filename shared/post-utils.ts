/**
 * 前后端共享的文章工具函数
 *
 * 消除 blog/src/lib/posts.ts（Astro 前台）与 cms/src/lib/blog-render.tsx（CMS 后端）
 * 之间的大量重复逻辑。两端均通过 cloud-blog/shared/post-utils 引用同一份实现。
 *
 * 设计原则：
 * - 泛型 + 最小公共类型：函数不依赖具体 CollectionEntry 或 MdEntry，只要求有 id/date/data
 * - 保持函数行为与原有实现**完全一致**，迁移时零行为差异
 */

/** 文章条目的最小公共类型：仅需 id + date + 任意 data */
export interface PostEntry<TData = Record<string, any>> {
  id: string;
  date?: Date | string;
  data: TData;
  body?: string;
}

/** 日期时间戳提取，null/undefined 安全 */
const getTime = (date?: Date | string) => {
  if (!date) return 0;
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

/** 本地时区格式化为 yyyy-MM-dd */
export const formatDate = (date?: Date | string) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 置顶优先 → 日期倒序 → 标题升序 */
export const sortPosts = <T extends PostEntry>(posts: T[]): T[] =>
  [...posts].sort((a, b) => {
    const stickyDiff =
      (Number(b.data.sticky ?? 0)) - (Number(a.data.sticky ?? 0));
    if (stickyDiff !== 0) return stickyDiff;
    const dateDiff = getTime(b.date) - getTime(a.date);
    if (dateDiff !== 0) return dateDiff;
    return String(a.data.title ?? '').localeCompare(
      String(b.data.title ?? ''),
      'zh-CN',
    );
  });

/** 纯日期倒序 → 标题升序 */
export const sortPostsByDate = <T extends PostEntry>(posts: T[]): T[] =>
  [...posts].sort((a, b) => {
    const dateDiff = getTime(b.date) - getTime(a.date);
    if (dateDiff !== 0) return dateDiff;
    return String(a.data.title ?? '').localeCompare(
      String(b.data.title ?? ''),
      'zh-CN',
    );
  });

/** 文章描述：优先 description，其次 AI 摘要首条，兜底默认文案 */
export const getPostDescription = <T extends PostEntry>(post: T): string =>
  (post.data.description ?? post.data.ai?.[0]) || '技术记录与实践笔记。';

/** 文章摘要：仅真实内容，无则 undefined（列表可省略该行） */
export const getPostExcerpt = <T extends PostEntry>(post: T) =>
  post.data.description ?? post.data.ai?.[0];

/** 文章分类（取第一个） */
export const getPostCategory = <T extends PostEntry>(post: T) =>
  post.data.categories?.[0];

/** 文章标签 */
export const getPostTags = <T extends PostEntry>(post: T): string[] =>
  post.data.tags ?? [];

/** 文章封面 */
export const getPostCover = <T extends PostEntry>(post: T) => post.data.cover;

/** 文章阅读时长估算（中日韩字符 1 字 + 英文 1 词 ≈ 350 单位/分钟） */
export const getReadingMinutes = <T extends PostEntry>(post: T): number => {
  const body = post.body ?? '';
  const cjkChars = body.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = body
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return Math.max(1, Math.ceil((cjkChars + words) / 350));
};

/** 相邻文章：上一篇 + 下一篇（按时间排序） */
export const getAdjacentPosts = <T extends PostEntry>(
  posts: T[],
  current: T,
) => {
  const ordered = sortPostsByDate(posts);
  const index = ordered.findIndex((p) => p.id === current.id);
  return {
    newer: index > 0 ? ordered[index - 1] : undefined,
    older:
      index >= 0 && index < ordered.length - 1
        ? ordered[index + 1]
        : undefined,
  };
};

/** 相关文章推荐：按分类 + 标签匹配度评分，返回 Top N */
export const getRelatedPosts = <T extends PostEntry>(
  posts: T[],
  current: T,
  limit = 3,
): T[] => {
  const currentCategory = getPostCategory(current);
  const currentTags = new Set(getPostTags(current));
  return sortPostsByDate(posts)
    .filter((post) => post.id !== current.id)
    .map((post) => {
      const sharedTags = getPostTags(post).filter((tag) =>
        currentTags.has(tag),
      );
      const sameCategory =
        currentCategory && getPostCategory(post) === currentCategory ? 1 : 0;
      return { post, score: sameCategory * 3 + sharedTags.length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.post);
};

/** 按年份归档分组 */
export const groupPostsByYear = <T extends PostEntry>(
  posts: T[],
): Array<{ year: string; posts: T[] }> => {
  const groups = new Map<string, T[]>();
  for (const post of sortPosts(posts)) {
    const d = post.date instanceof Date ? post.date : new Date(post.date);
    const year = d && !isNaN(d.getTime())
      ? d.getFullYear().toString()
      : '未注明日期';
    groups.set(year, [...(groups.get(year) ?? []), post]);
  }
  return [...groups.entries()].map(([year, yearPosts]) => ({ year, posts: yearPosts }));
};

// ---------------------------------------------------------------------------
// 分类 / 标签工具
// ---------------------------------------------------------------------------

/** 统计条目频次 */
const countItems = (items: string[]) =>
  items.reduce<Map<string, number>>((counts, item) => {
    counts.set(String(item), (counts.get(String(item)) ?? 0) + 1);
    return counts;
  }, new Map());

/** 频次降序 + 名称升序排列 */
const mapToSortedTerms = (counts: Map<string, number>) =>
  [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'),
    );

/** 提取所有分类（含频次统计） */
export const getCategories = <T extends PostEntry>(
  posts: T[],
): Array<{ name: string; count: number }> =>
  mapToSortedTerms(countItems(posts.flatMap((post) => post.data.categories ?? [])));

/** 提取所有标签（含频次统计） */
export const getTags = <T extends PostEntry>(
  posts: T[],
): Array<{ name: string; count: number }> =>
  mapToSortedTerms(countItems(posts.flatMap((post) => getPostTags(post))));

/** 分类归档路径 */
export const getCategoryPath = (category: string) =>
  `/categories/${encodeURIComponent(category)}/`;

/** 标签归档路径 */
export const getTagPath = (tag: string) =>
  `/tags/${encodeURIComponent(tag)}/`;

/** 按分类筛选文章（已排序） */
export const getPostsByCategory = <T extends PostEntry>(
  posts: T[],
  category: string,
): T[] => sortPosts(posts).filter((post) => post.data.categories?.includes(category));

/** 按标签筛选文章（已排序） */
export const getPostsByTag = <T extends PostEntry>(
  posts: T[],
  tag: string,
): T[] => sortPosts(posts).filter((post) => getPostTags(post).includes(tag));
