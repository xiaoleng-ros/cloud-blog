/**
 * 站内搜索的纯逻辑层：条目结构 + 打分 + 高亮。
 *
 * 这里刻意不 import astro:content —— 浮层与 /search 页都要在浏览器里跑这份代码，
 * 一旦被构建期的依赖污染，Vite 打包就会把 getCollection 带进客户端。
 * 生成条目见 lib/site-index.ts（只在构建期跑）。
 */

export type IndexKind = 'page' | 'post' | 'note' | 'project' | 'category' | 'tag';

export interface IndexEntry {
  kind: IndexKind;
  title: string;
  /** 结果行副标题：摘要 / 分组名 / 首句，可为空串 */
  subtitle: string;
  /** 弱信息：日期、「N 篇」，靠右显示，可为空串 */
  meta: string;
  url: string;
  tags: string[];
  /** 构建期拼好的小写匹配域；口径是「覆盖面优先」，不含正文 */
  text: string;
}

export const KIND_ORDER: IndexKind[] = ['page', 'post', 'note', 'project', 'category', 'tag'];

/** 索引产物的唯一地址：端点、浮层、/search 兜底页都从这里取，避免三处各写一遍 */
export const SITE_INDEX_URL = '/site-index.json';

export const KIND_LABEL: Record<IndexKind, string> = {
  page: '页面',
  post: '文章',
  note: '随笔',
  project: '项目',
  category: '分类',
  tag: '标签',
};

/** 图标名必须来自 shared/icon-paths 那张表，否则渲染成空白 */
export const KIND_ICON: Record<IndexKind, string> = {
  page: 'compass',
  post: 'layers',
  note: 'smile',
  project: 'spark',
  category: 'archive',
  tag: 'hash',
};

export interface SearchHit {
  entry: IndexEntry;
  score: number;
}

export function splitTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 权重沿用改造前 /search 页的口径：标题 4 / 分类标签 3 / 副标题 2 / 其余 1 */
function scoreTerm(entry: IndexEntry, term: string): number {
  if (entry.title.toLowerCase().includes(term)) return 4;
  if (entry.tags.join(' ').toLowerCase().includes(term)) return 3;
  if (entry.subtitle.toLowerCase().includes(term)) return 2;
  if (entry.text.includes(term)) return 1;
  return 0;
}

export function searchEntries(entries: IndexEntry[], query: string): SearchHit[] {
  const terms = splitTerms(query);
  if (terms.length === 0) return [];

  return entries
    .map((entry) => ({
      entry,
      score: terms.reduce((sum, term) => sum + scoreTerm(entry, term), 0),
    }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'zh-CN'),
    );
}

/** 按分组顺序排好，供浮层与 /search 页各自决定每组留几条 */
export function groupHits(hits: SearchHit[]): Array<{ kind: IndexKind; hits: SearchHit[] }> {
  return KIND_ORDER.map((kind) => ({
    kind,
    hits: hits.filter((hit) => hit.entry.kind === kind),
  })).filter((group) => group.hits.length > 0);
}

export function entriesOfKind(entries: IndexEntry[], kind: IndexKind): IndexEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}

export function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 先整体转义、再一次性插入 <mark>：多词分轮替换会让第二轮命中上一轮的标签名，
 * 产出破损 HTML。转义后形态变了的词（含 & < >）直接放弃高亮，
 * 否则可能把 &amp; 这类实体从中间切开。
 */
export function highlight(value: string, terms: string[]): string {
  const safe = terms
    .filter((term) => term && escapeHtml(term) === term)
    .sort((a, b) => b.length - a.length);

  const escaped = escapeHtml(value);
  if (safe.length === 0) return escaped;

  const pattern = new RegExp(`(${safe.map((term) => escapeRegExp(term)).join('|')})`, 'gi');
  return escaped.replace(pattern, '<mark>$1</mark>');
}
