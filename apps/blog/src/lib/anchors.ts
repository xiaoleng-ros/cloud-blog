/**
 * 页面锚点 id 的单一实现（构建期纯函数）。
 *
 * 这些 id 同时被两处消费：页面本身（notes.astro / about.astro 的 DOM id）
 * 与站内搜索索引（site-index.ts 生成的深链）。两边必须永远一致，
 * 所以收敛到这一份实现，避免「注释说同源、实际各写各的」。
 */
import type { CollectionEntry } from 'astro:content';
import { toShanghaiParts } from './posts';

type Note = CollectionEntry<'notes'>;
type Project = CollectionEntry<'projects'>;

/**
 * 随笔的月份锚点：按日期倒序，每月第一条拿到 `t-{年}-{月}`，其余条目没有 id。
 * 页面月份索引与搜索深链共用；日历口径固定 Asia/Shanghai（与站内其它日期一致）。
 */
export function noteMonthAnchors(notes: Note[]): Map<string, string> {
  const ordered = [...notes].sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  const seenMonth = new Set<string>();
  const anchors = new Map<string, string>();
  for (const note of ordered) {
    const parts = toShanghaiParts(note.data.date);
    if (!parts) continue;
    const key = `${parts.year}-${Number(parts.month)}`;
    if (seenMonth.has(key)) continue;
    seenMonth.add(key);
    anchors.set(note.id, `t-${key}`);
  }
  return anchors;
}

/**
 * 项目分组名 → 合法 HTML id：小写、非字母数字连续段转单个 -、去首尾 -。
 * 纯中文/空格类分组名会被清空，用分组序号兜底保证 id 唯一且非空。
 */
export function projectGroupId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `proj-${index}${slug ? `-${slug}` : ''}`;
}

/** 分组名 → id 映射（按首次出现顺序编号），关于页分组与站内搜索深链共用 */
export function projectGroupIds(projects: Project[]): Map<string, string> {
  const order: string[] = [];
  for (const project of projects) {
    if (!order.includes(project.data.group)) order.push(project.data.group);
  }
  const ids = new Map<string, string>();
  order.forEach((title, index) => ids.set(title, projectGroupId(title, index)));
  return ids;
}
