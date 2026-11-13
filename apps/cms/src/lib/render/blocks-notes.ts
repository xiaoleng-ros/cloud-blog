/**
 * 随笔页区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry } from '../blog-sync'
import { type NoteItem, type SkillItem } from 'cloud-blog/shared/about-format'
import { formatDate, toShanghaiParts } from 'cloud-blog/shared/post-utils'
import { footerBlocks, renderMorePanel, renderNavLinks } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { renderMarkdown } from './markdown'
import { buildSiteIndex } from './site-index'
import { escapeHtml, toDate } from './util'

export const MOOD: Record<string, string> = {
  晴: 'sun',
  晴天: 'sun',
  sunny: 'sun',
  clear: 'sun',
  阴: 'cloud',
  阴天: 'cloud',
  cloudy: 'cloud',
  overcast: 'cloud',
  多云: 'cloud',
  partlycloudy: 'cloud',
  雨: 'cloud-drizzle',
  下雨: 'cloud-drizzle',
  小雨: 'cloud-drizzle',
  rain: 'cloud-drizzle',
  rainy: 'cloud-drizzle',
  大雨: 'cloud-rain',
  暴雨: 'cloud-rain',
  storm: 'cloud-rain',
  heavyrain: 'cloud-rain',
  雷: 'cloud-lightning',
  雷雨: 'cloud-lightning',
  thunder: 'cloud-lightning',
  雪: 'cloud-snow',
  下雪: 'cloud-snow',
  snow: 'cloud-snow',
  snowy: 'cloud-snow',
  风: 'wind',
  大风: 'wind',
  windy: 'wind',
  wind: 'wind',
  雾: 'fog',
  fog: 'fog',
  foggy: 'fog',
  夜: 'moon',
  夜晚: 'moon',
  晚上: 'moon',
  night: 'moon',
  开心: 'smile',
  高兴: 'smile',
  快乐: 'smile',
  happy: 'smile',
  平静: 'meh',
  平和: 'meh',
  还好: 'meh',
  calm: 'meh',
  难过: 'frown',
  伤心: 'frown',
  emo: 'frown',
  sad: 'frown',
  累: 'tired',
  疲惫: 'tired',
  困: 'tired',
  tired: 'tired',
  爱: 'heart',
  喜欢: 'heart',
  love: 'heart',
  思考: 'idea',
  想法: 'idea',
  thinking: 'idea',
  idea: 'idea',
}

export function moodIcon(mood?: string): string | undefined {
  if (!mood) return undefined
  const raw = mood.trim()
  return MOOD[raw] ?? MOOD[raw.toLowerCase().replace(/[\s-]/g, '')]
}

/** 渲染单条随笔（note__meta + note__main + markdown 正文） */

export async function renderNote(note: MdEntry, altMap: Map<string, string>, anchor?: string): Promise<string> {
  const date = toDate(note.data.date)
  const { html } = await renderMarkdown(note.body, altMap)
  const mood = moodIcon(note.data.mood)

  const moodHtml = note.data.mood
    ? mood
      ? `<span class="note__mood">${iconSvg(mood, 15)}<span class="note__mood-text">${escapeHtml(note.data.mood)}</span></span>`
      : `<span class="note__mood note__mood-text">${escapeHtml(note.data.mood)}</span>`
    : ''

  const tagsHtml =
    note.data.tags && note.data.tags.length > 0
      ? `<div class="tag-list note__tags" aria-label="标签">${note.data.tags.map((t: string) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
      : ''

  return `<article class="note"${anchor ? ` id="${anchor}"` : ''}>
  <div class="note__meta">
    ${date ? `<time datetime="${date.toISOString()}">${formatDate(date)}</time>` : ''}
    ${moodHtml}
  </div>
  <div class="note__main">
    ${note.data.title ? `<h3 class="note__title">${escapeHtml(note.data.title)}</h3>` : ''}
    <div class="note__body post-content">${html}</div>
    ${tagsHtml}
  </div>
</article>`
}

/** 随笔页 feed 内容（锚点 notes.astro 的 div[data-sync-block="notesFeed"]）与
/**
 * 随笔月份锚点：按日期倒序，每月第一条拿 `t-{年}-{月}`（月份不补零），其余条目没有 id。
 * 与 notes.astro（lib/anchors.ts）同规则；随笔列表页与搜索深链共用（见 buildSiteIndex）。
 */

export function noteMonthAnchorIds(notes: MdEntry[]): Map<string, string> {
  const ordered = [...notes].sort(
    (a, b) => (toDate(b.data.date)?.getTime() ?? 0) - (toDate(a.data.date)?.getTime() ?? 0),
  )
  const seenMonth = new Set<string>()
  const anchors = new Map<string, string>()
  for (const note of ordered) {
    const parts = toShanghaiParts(toDate(note.data.date))
    if (!parts) continue
    const key = `${parts.year}-${Number(parts.month)}`
    if (seenMonth.has(key)) continue
    seenMonth.add(key)
    anchors.set(note.id, `t-${key}`)
  }
  return anchors
}

/**
 *  时间索引内容（锚点 aside[data-sync-block="notesAside"]） */

export async function renderNotesFeed(
  notes: MdEntry[],
  altMap: Map<string, string>,
): Promise<{
  feed: string
  aside: string
}> {
  const sorted = [...notes].sort(
    (a, b) => (toDate(b.data.date)?.getTime() ?? 0) - (toDate(a.data.date)?.getTime() ?? 0),
  )

  const byYear: { year: string; notes: MdEntry[] }[] = []
  for (const note of sorted) {
    const year = toShanghaiParts(toDate(note.data.date))?.year ?? ''
    const group = byYear.find((g) => g.year === year)
    if (group) group.notes.push(note)
    else byYear.push({ year, notes: [note] })
  }

  const monthAnchor = noteMonthAnchorIds(sorted)

  const timeIndex = byYear.map((group) => ({
    year: group.year,
    months: group.notes
      .filter((n) => monthAnchor.has(n.id))
      .map((n) => ({
        label: `${Number(toShanghaiParts(toDate(n.data.date))!.month)}月`,
        anchor: monthAnchor.get(n.id)!,
      })),
  }))

  const feedParts: string[] = []
  for (const group of byYear) {
    const items: string[] = []
    for (const note of group.notes) {
      items.push(await renderNote(note, altMap, monthAnchor.get(note.id)))
    }
    feedParts.push(
      `<section class="notes-year" id="y-${group.year}"><h2 class="notes-year__label"><span>${group.year}</span></h2>${items.join('')}</section>`,
    )
  }

  const aside =
    byYear.length > 1
      ? `<nav class="toc" aria-labelledby="notes-time-heading">
    <h2 id="notes-time-heading">时间</h2>
    <ol>
      ${timeIndex
        .map(
          (g) => `<li class="notes-index__year">
    <a href="#y-${g.year}">${g.year}</a>
    <div class="notes-index__sub"><ol class="notes-index__months">${g.months
      .map((m) => `<li class="toc__item--depth-3"><a href="#${m.anchor}">${m.label}</a></li>`)
      .join('')}</ol></div>
  </li>`,
        )
        .join('')}
    </ol>
  </nav>`
      : ''

  return { feed: feedParts.join(''), aside }
}

// ---------------------------------------------------------------------------
// 关于页（about.astro）：正文/便签/技能环 + 项目区
// ---------------------------------------------------------------------------

// SkillItem / NoteItem 与解析统一走 shared/about-format（前台同一份实现）

export async function notesBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const settings = ctx.settings
  const { feed, aside } = await renderNotesFeed(ctx.notes, ctx.mediaAltMap)
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/notes'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    notesFeed: feed,
    notesAside: aside,
  }
}

/** 分类页 / 标签页 */
