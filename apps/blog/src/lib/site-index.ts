/**
 * 站点索引生成（只在构建期跑）：把「站内所有可去之处」摊平成同一形状的条目。
 *
 * 口径是覆盖面优先：每个页面、每篇文章/随笔/项目、每个分类与标签都进索引，
 * 但匹配域只到标题/摘要/分类/标签/关键词，不灌正文。打分与高亮在 lib/search-match.ts。
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import type { IndexEntry } from './search-match';
import { getNavItems } from './site-settings';
import {
  formatDate,
  getCategories,
  getCategoryPath,
  getPostCategory,
  getPostExcerpt,
  getPostPath,
  getPostTags,
  getTags,
  getTagPath,
  sortPosts,
  toShanghaiParts,
} from './posts';

type BlogPost = CollectionEntry<'posts'>;
type Note = CollectionEntry<'notes'>;
type Project = CollectionEntry<'projects'>;

/** 拼小写匹配域：空值直接丢掉，避免多余空格把词切碎 */
function matchField(...parts: Array<string | string[] | undefined | null>): string {
  return parts
    .flat()
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();
}

const stripMarkdown = (value: string) =>
  value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-+]\s+/, '')
    .trim();

/** 随笔大多没有标题，拿正文首行当摘要（首行即内容本身，不是全文索引） */
function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const text = stripMarkdown(line);
    if (text) return text.length > 46 ? `${text.slice(0, 46)}…` : text;
  }
  return '';
}

/**
 * 随笔落在 /notes/ 的月份锚点上。规则与 notes.astro 的 monthAnchor 同源
 * （每月第一条拿到 `t-{年}-{月}`，其余条目页面上本来就没有 id）。
 * 两处若走偏，最坏结果是页面不滚动，不会 404。
 */
function noteAnchors(notes: Note[]): Map<string, string> {
  const ordered = [...notes].sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  const seenMonths = new Set<string>();
  const anchors = new Map<string, string>();
  for (const note of ordered) {
    const parts = toShanghaiParts(note.data.date);
    if (!parts) continue;
    const key = `${parts.year}-${Number(parts.month)}`;
    if (seenMonths.has(key)) continue;
    seenMonths.add(key);
    anchors.set(note.id, `t-${key}`);
  }
  return anchors;
}

/** 分组锚点 id：与 about.astro 的 groupDomId 同一套 slug 规则 */
function projectGroupIds(projects: Project[]): Map<string, string> {
  const order: string[] = [];
  for (const project of projects) {
    if (!order.includes(project.data.group)) order.push(project.data.group);
  }
  const ids = new Map<string, string>();
  order.forEach((title, index) => {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    ids.set(title, `proj-${index}${slug ? `-${slug}` : ''}`);
  });
  return ids;
}

/**
 * 导航之外的常驻页面。不走 getNavItems()——那是顶栏导航项，
 * 统计页只挂在「更多」面板里，不占顶栏位置，但要在站内搜索里能被搜到。
 */
const EXTRA_PAGES: Array<{ href: string; label: string; keywords: string }> = [
  { href: '/stats/', label: '统计', keywords: '数据 statistics 归档 标签墙' },
  { href: '/tags/', label: '标签墙', keywords: '标签 tags 分类 cloud 拾取' },
];

function pageEntries(navItems: Array<{ href: string; label: string }>): IndexEntry[] {
  const nav = navItems.map((item) => ({
    kind: 'page' as const,
    title: item.label,
    subtitle: '',
    meta: '',
    url: item.href,
    tags: [],
    text: matchField(item.label, item.href),
  }));
  const extra = EXTRA_PAGES.map((item) => ({
    kind: 'page' as const,
    title: item.label,
    subtitle: '',
    meta: '',
    url: item.href,
    tags: [],
    text: matchField(item.label, item.href, item.keywords),
  }));
  return [...nav, ...extra];
}

function postEntries(posts: BlogPost[]): IndexEntry[] {
  return posts.map((post) => {
    const excerpt = getPostExcerpt(post) ?? '';
    return {
      kind: 'post',
      title: post.data.title,
      subtitle: excerpt,
      meta: post.data.date ? formatDate(post.data.date) : '',
      url: getPostPath(post),
      tags: getPostTags(post),
      text: matchField(
        post.data.title,
        excerpt,
        getPostCategory(post),
        getPostTags(post),
        post.data.keywords,
      ),
    };
  });
}

function noteEntries(notes: Note[]): IndexEntry[] {
  const anchors = noteAnchors(notes);
  return notes.map((note) => {
    const title = note.data.title?.trim();
    const excerpt = firstLine(note.body ?? '');
    const anchor = anchors.get(note.id);
    return {
      kind: 'note',
      title: title || excerpt || `${formatDate(note.data.date)} 的随笔`,
      subtitle: title ? excerpt : '',
      meta: formatDate(note.data.date),
      url: anchor ? `/notes/#${anchor}` : '/notes/',
      tags: note.data.tags ?? [],
      text: matchField(note.data.title, excerpt, note.data.mood, note.data.tags),
    };
  });
}

function projectEntries(projects: Project[]): IndexEntry[] {
  const groupIds = projectGroupIds(projects);
  return projects.map((project) => {
    const { data } = project;
    return {
      kind: 'project',
      title: data.title,
      subtitle: data.description ?? '',
      meta: data.group,
      // 项目本身没有详情页：能跳到写它的那篇文章就跳文章，否则落到关于页的分组锚点
      url: data.articleHref ?? `/about/#${groupIds.get(data.group)}`,
      tags: data.tags ?? [],
      text: matchField(data.title, data.description, data.group, data.owner, data.tags),
    };
  });
}

function termEntries(posts: BlogPost[]): IndexEntry[] {
  const categories = getCategories(posts).map((term) => ({
    kind: 'category' as const,
    title: term.name,
    subtitle: '',
    meta: `${term.count} 篇`,
    url: getCategoryPath(term.name),
    tags: [],
    text: matchField(term.name),
  }));
  const tags = getTags(posts).map((term) => ({
    kind: 'tag' as const,
    title: term.name,
    subtitle: '',
    meta: `${term.count} 篇`,
    url: getTagPath(term.name),
    tags: [],
    text: matchField(term.name),
  }));
  return [...categories, ...tags];
}

export async function buildSiteIndex(): Promise<IndexEntry[]> {
  const [posts, notes, projects, navItems] = await Promise.all([
    getCollection('posts').then(sortPosts),
    getCollection('notes'),
    getCollection('projects'),
    getNavItems(),
  ]);

  return [
    ...pageEntries(navItems),
    ...postEntries(posts),
    ...noteEntries(notes),
    ...projectEntries(projects),
    ...termEntries(posts),
  ];
}
