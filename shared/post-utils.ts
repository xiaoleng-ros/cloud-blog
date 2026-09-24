/**
 * 前后端共享的文章工具函数
 *
 * 消除 blog/src/lib/posts.ts（Astro 前台）与 cms/src/lib/blog-render.tsx（CMS 后端）
 * 之间的大量重复逻辑。两端均通过 cloud-blog/shared/post-utils 引用同一份实现。
 *
 * 设计原则：
 * - 泛型 + 最小公共类型：函数不依赖具体 CollectionEntry 或 MdEntry
 * - 兼容两种数据结构：
 *   · Astro CollectionEntry → 字段在 .data 下
 *   · CMS MdEntry → 字段在顶层
 * - 保持函数行为与原有实现完全一致，迁移时零行为差异
 */

/** 文章条目的最小公共类型：仅需 id + data（可选），兼容 Astro 和 CMS 两种数据源 */
export interface PostEntry<TData = any> {
  id: string;
  /** Astro CollectionEntry 的顶层日期；CMS MdEntry 无此字段，日期在 data.date 中 */
  date?: Date | string;
  /** Astro CollectionEntry 的 data 属性；CMS MdEntry 无此属性，字段直接在顶层 */
  data?: TData;
  body?: string;
}

/** 从文章条目中获取字段值：优先 post.data.xxx，回退到 post.xxx（兼容两种数据源） */
export const getVal = <T = any>(post: PostEntry, field: string): T | undefined => {
  if (post.data && typeof post.data === 'object') {
    const val = (post.data as any)[field];
    if (val !== undefined) return val as T;
  }
  return (post as any)[field] as T | undefined;
};

/** 提取文章日期：优先顶层 date（Astro），回退到 data.date（CMS） */
const getPostDate = (post: PostEntry): Date | string | undefined =>
  post.date ?? getVal<Date | string>(post, 'date');

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
      (Number(getVal(b, 'sticky') ?? 0)) - (Number(getVal(a, 'sticky') ?? 0));
    if (stickyDiff !== 0) return stickyDiff;
    const dateDiff = getTime(getPostDate(b)) - getTime(getPostDate(a));
    if (dateDiff !== 0) return dateDiff;
    return String(getVal(a, 'title') ?? '').localeCompare(
      String(getVal(b, 'title') ?? ''),
      'zh-CN',
    );
  });

/** 纯日期倒序 → 标题升序 */
export const sortPostsByDate = <T extends PostEntry>(posts: T[]): T[] =>
  [...posts].sort((a, b) => {
    const dateDiff = getTime(getPostDate(b)) - getTime(getPostDate(a));
    if (dateDiff !== 0) return dateDiff;
    return String(getVal(a, 'title') ?? '').localeCompare(
      String(getVal(b, 'title') ?? ''),
      'zh-CN',
    );
  });

/** 文章描述：优先 description，其次 AI 摘要首条，兜底默认文案 */
export const getPostDescription = <T extends PostEntry>(post: T): string =>
  (getVal(post, 'description') ?? getVal(post, 'ai')?.[0]) ||
  '技术记录与实践笔记。';

/** 文章摘要：仅真实内容，无则 undefined（列表可省略该行） */
export const getPostExcerpt = <T extends PostEntry>(post: T) =>
  getVal(post, 'description') ?? getVal(post, 'ai')?.[0];

/** 文章分类（取第一个） */
export const getPostCategory = <T extends PostEntry>(post: T) =>
  getVal<string[]>(post, 'categories')?.[0];

/** 文章标签 */
export const getPostTags = <T extends PostEntry>(post: T): string[] =>
  getVal<string[]>(post, 'tags') ?? [];

/** 文章封面 */
export const getPostCover = <T extends PostEntry>(post: T) =>
  getVal(post, 'cover');

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

/** 获取文章的更新日期（优先取 data.updated，其次取顶层 date / data.date） */
export const getPostUpdatedDate = <T extends PostEntry>(
  post: T,
): Date | undefined => {
  const raw = getVal(post, 'updated') ?? getPostDate(post);
  if (!raw) return undefined;
  return raw instanceof Date ? raw : new Date(raw);
};

/** 按年份归档分组 */
export const groupPostsByYear = <T extends PostEntry>(
  posts: T[],
): Array<{ year: string; posts: T[] }> => {
  const groups = new Map<string, T[]>();
  for (const post of sortPosts(posts)) {
    const raw = getPostDate(post);
    // 无日期字段时直接归入「未注明日期」，避免 new Date(undefined) 产生 Invalid Date
    const d = raw ? (raw instanceof Date ? raw : new Date(raw)) : undefined;
    const year =
      d && !isNaN(d.getTime()) ? d.getFullYear().toString() : '未注明日期';
    groups.set(year, [...(groups.get(year) ?? []), post]);
  }
  return [...groups.entries()].map(([year, yearPosts]) => ({
    year,
    posts: yearPosts,
  }));
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
  mapToSortedTerms(
    countItems(
      posts.flatMap((post) => getVal<string[]>(post, 'categories') ?? []),
    ),
  );

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
): T[] =>
  sortPosts(posts).filter(
    (post) => getVal<string[]>(post, 'categories')?.includes(category),
  );

/** 按标签筛选文章（已排序） */
export const getPostsByTag = <T extends PostEntry>(
  posts: T[],
  tag: string,
): T[] => sortPosts(posts).filter((post) => getPostTags(post).includes(tag));
