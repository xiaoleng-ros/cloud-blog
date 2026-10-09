/**
 * 站点统计聚合：文章 / 分类 / 标签 / 逐年分布 / 字数与阅读时长。
 *
 * 单独成文件而不是塞进页面：这些东西后台预览（CMS）与前台构建都要用同一套算法，
 * 两边各算一次必然漂移（分类顺序、字数口径都容易对不上）。
 *
 * 字数口径与 shared/post-utils 的 getReadingMinutes 保持一致：
 * 中日韩字符按字算，英文按词算，两者相加即「字数」。
 */
import { getPostTags, toShanghaiParts, type PostEntry } from './post-utils';

/** 单篇文章的字数（CJK 按字 + 英文按词，与 getReadingMinutes 同口径） */
export function getPostWordCount<T extends PostEntry>(post: T): number {
  const body = post.body ?? '';
  // 与 getReadingMinutes 用同一组码点区间，不另写字面量以免两处漂移
  const cjk = body.match(/[一-鿿]/g)?.length ?? 0;
  const words = body.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return cjk + words;
}

export interface TermCount {
  name: string;
  count: number;
}

export interface YearStat {
  year: string;
  /** 当年文章数 */
  posts: number;
  /** 当年字数合计 */
  words: number;
  /** 当年标签去重数 */
  tags: number;
}

export interface CategorySlice extends TermCount {
  /** 0~1，供环形图算弧度 */
  ratio: number;
}

export interface SiteStats {
  postCount: number;
  /** 字数合计 */
  wordCount: number;
  categoryCount: number;
  tagCount: number;
  /** 分类分布，按文章数降序 */
  categories: CategorySlice[];
  /** 标签分布，按文章数降序 */
  tags: TermCount[];
  /** 逐年分布，按年份倒序 */
  years: YearStat[];
  /** 最早一年 / 最近一年 */
  firstYear: string;
  lastYear: string;
  /** 累计阅读时长（分钟） */
  readMinutes: number;
}

/** 分类取第一个（与 getPostCategory 同一口径：data.categories 归一为数组后取首项） */
function primaryCategory(post: PostEntry): string {
  const cats = (post.data as { categories?: unknown })?.categories;
  if (Array.isArray(cats) && cats.length > 0) return String(cats[0]);
  return '未分类';
}

/** 把 [{name,count}] 按 count 降序、同数按名称升序排一遍（顺序稳定，diff 干净） */
function sortTerms(terms: TermCount[]): TermCount[] {
  return [...terms].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function countBy<T>(items: T[], key: (item: T) => string | undefined): TermCount[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const name = key(item);
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return sortTerms([...map].map(([name, count]) => ({ name, count })));
}

/**
 * 汇总全站统计。
 * @param posts 已按时间倒序或正序都可以，内部自己按年份分组后倒序输出
 */
export function buildSiteStats(posts: PostEntry[]): SiteStats {
  const catTerms = countBy(posts, primaryCategory);
  const tagTerms = countBy(
    posts.flatMap((p) => getPostTags(p).map((name) => ({ name }))),
    (item) => item.name,
  );
  const totalCats = catTerms.reduce((sum, t) => sum + t.count, 0);

  const yearMap = new Map<string, { posts: number; words: number; tagSet: Set<string> }>();
  let wordCount = 0;
  let readMinutes = 0;
  let firstStamp = Number.POSITIVE_INFINITY;
  let lastStamp = Number.NEGATIVE_INFINITY;

  for (const post of posts) {
    const year = toShanghaiParts((post.data as { date?: Date | string })?.date)?.year;
    if (!year) continue;

    const bucket = yearMap.get(year) ?? { posts: 0, words: 0, tagSet: new Set<string>() };
    const words = getPostWordCount(post);
    bucket.posts += 1;
    bucket.words += words;
    for (const tag of getPostTags(post)) bucket.tagSet.add(tag);
    yearMap.set(year, bucket);

    wordCount += words;
    // 与 getReadingMinutes 同口径：每 350 单位算一分钟，向上取整；此处累计的是「按总量一次换算」
    readMinutes += Math.ceil(words / 350);

    const stamp = new Date((post.data as { date?: Date | string })?.date ?? NaN).getTime();
    if (!Number.isNaN(stamp)) {
      if (stamp < firstStamp) firstStamp = stamp;
      if (stamp > lastStamp) lastStamp = stamp;
    }
  }

  const years: YearStat[] = [...yearMap]
    .map(([year, v]) => ({ year, posts: v.posts, words: v.words, tags: v.tagSet.size }))
    .sort((a, b) => Number(b.year) - Number(a.year));

  return {
    postCount: posts.length,
    wordCount,
    categoryCount: catTerms.length,
    tagCount: tagTerms.length,
    categories: catTerms.map((t) => ({ ...t, ratio: totalCats > 0 ? t.count / totalCats : 0 })),
    tags: tagTerms,
    years,
    firstYear: years.length > 0 ? years[years.length - 1].year : '—',
    lastYear: years.length > 0 ? years[0].year : '—',
    readMinutes,
  };
}
