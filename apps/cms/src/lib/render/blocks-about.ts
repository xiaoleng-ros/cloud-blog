/**
 * 关于页区块（简介 / 技能环 / 项目）
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { ProjectEntry } from '../blog-sync'
import { safeHref } from 'cloud-blog/shared/html-safety'
import {
  parseNotes,
  parseSkills,
  resolveAboutColor,
  splitAboutParagraphs,
  type NoteItem,
  type SkillItem,
} from 'cloud-blog/shared/about-format'
import { OFFLINE_ABOUT } from 'cloud-blog/shared/site-defaults'
import { sortPosts, toShanghaiParts } from 'cloud-blog/shared/post-utils'
import { footerBlocks, renderMorePanel, renderNavLinks } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { iconSvg } from './icons'
import { currentYearShanghai, escapeAttr, escapeHtml, toDate } from './util'

export interface AboutData {
  paragraphs: string[]
  notes: NoteItem[]
  skills: SkillItem[]
}

/** 关于页文案：与前台 getAboutContent() 同规则——后台填了才有，宕机才兜底 */

export function getAboutData(settings: Record<string, any> | null): AboutData {
  if (settings === null) {
    return {
      paragraphs: OFFLINE_ABOUT.paragraphs,
      notes: OFFLINE_ABOUT.notes,
      skills: OFFLINE_ABOUT.skills,
    }
  }
  return {
    // 正文：==记号== → 高亮 span（整体转义后仅还原记号，比旧 HTML 白名单更严）；
    // 存量 HTML 写法在解析时自动转换，无需迁移数据
    paragraphs: splitAboutParagraphs(settings.aboutParagraphs),
    notes: parseNotes(settings.aboutNotes),
    skills: parseSkills(settings.skills),
  }
}

/** 技能环（与 SkillRing.astro 结构一致）：颜色 token 走主题变量，hex 原样 */

export function renderSkillRing(skill: SkillItem): string {
  const ringColor = resolveAboutColor(skill.color) || 'var(--sticky-yellow)'
  const percent = Math.min(100, Math.max(0, skill.value))
  return `<div class="skill-ring">
  <div class="skill-ring__track" aria-hidden="true">
    <div class="skill-ring__fill" style="--ring-color: ${ringColor}; --percent: ${percent}%"></div>
    <span class="skill-ring__value">${percent}%</span>
  </div>
  <div class="skill-ring__text">
    <strong>${escapeHtml(skill.label)}</strong>
    ${skill.sublabel ? `<small>${escapeHtml(skill.sublabel)}</small>` : ''}
  </div>
</div>`
}

/** 关于页顶部内容（锚点 about.astro 的 section[data-sync-block="aboutProfile"]） */

export function renderAboutProfile(about: AboutData, postCount: number, firstYear: number): string {
  const paragraphsHtml = about.paragraphs.map((p) => `<p class="about__text">${p}</p>`).join('')
  const notesHtml = about.notes
    .map((n) => {
      const color = resolveAboutColor(n.color)
      return `<div class="about__note"${color ? ` style="--note-color: ${escapeAttr(color)}"` : ''}>
    <span class="about__note-tape" aria-hidden="true"></span>
    <strong>${escapeHtml(n.title)}</strong>
    <span>${escapeHtml(n.subtitle)}</span>
  </div>`
    })
    .join('')
  // 「ABOUT / 关于我 / 简介行」按用户要求写死（原字段已删）；结构与 about.astro 逐字对齐
  const introHtml = `<div class="about__intro-card">
    <span class="about__eyebrow">ABOUT</span>
    <h1 id="about-heading" class="about__lead">关于我</h1>
    ${paragraphsHtml}
    <div class="about__facts"><span class="about__fact">${postCount} 篇文章</span><span class="about__fact">写于 ${firstYear} 至今</span><span class="about__fact">全站由 AI 开发</span></div>
  </div>`
  const notesSection = about.notes.length > 0 ? `<div class="about__notes">${notesHtml}</div>` : ''

  return `${introHtml}
  ${notesSection}`
}

/** 关于页技能环内容（锚点 about.astro 的 section[data-sync-block="aboutSkills"]） */

export function renderAboutSkills(skills: SkillItem[]): string {
  if (skills.length === 0) return ''
  return `<div class="section__header">
    <h2 id="skills-heading">我的小本领</h2>
  </div>
  <div class="skill-grid">${skills.map(renderSkillRing).join('')}</div>`
}

/** 实心星星图标（项目 Star 数） */

export const STAR_FILL_SVG =
  '<svg class="proj__stars-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'

export interface ProjectGroup {
  title: string
  description: string
  items: ProjectEntry[]
}

/** 把扁平项目列表按 group 聚合，组内按 sortOrder 升序，保留首次出现的分组描述 */

export function groupProjects(projects: ProjectEntry[]): ProjectGroup[] {
  const order: string[] = []
  const byGroup = new Map<string, { description: string; items: ProjectEntry[] }>()
  for (const p of projects) {
    if (!byGroup.has(p.group)) {
      byGroup.set(p.group, { description: p.groupDescription ?? '', items: [] })
      order.push(p.group)
    }
    byGroup.get(p.group)!.items.push(p)
  }
  return order.map((title) => {
    const g = byGroup.get(title)!
    return { title, description: g.description, items: g.items }
  })
}

/** 单个项目卡片（about.astro .proj）；「笔记」链接文字写死（原字段已删），有 articleHref 才出 */

export function renderProject(item: ProjectEntry): string {
  const starsHtml = item.stars > 0 ? `<span class="proj__stars">${STAR_FILL_SVG}${item.stars}</span>` : ''
  const tagsHtml = (item.tags ?? []).map((t) => `<small>${escapeHtml(t)}</small>`).join('')
  // 项目链接同样是后台自由填写：与前台 fetchProjects 用同一套协议白名单
  const articleHref = safeHref(item.articleHref, '')
  const noteHtml = articleHref
    ? `<a class="proj__note" href="${escapeAttr(articleHref)}">笔记${iconSvg('arrow-right', 13)}</a>`
    : ''
  const projectHref = safeHref(item.href, '#')
  return `<article class="proj">
  <span class="proj__icon">${iconSvg(item.icon, 18)}</span>
  <div class="proj__body">
    <span class="proj__owner">${escapeHtml(item.owner ?? '')}${starsHtml}</span>
    <h3 class="proj__title">
      <a href="${escapeAttr(projectHref)}"${
        projectHref.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>
        ${escapeHtml(item.title)}${iconSvg('arrow-up-right', 16, 'proj__go')}
      </a>
    </h3>
    <p class="proj__desc">${escapeHtml(item.description ?? '')}</p>
    <div class="proj__foot">
      <span class="proj__tags">${tagsHtml}</span>
      ${noteHtml}
    </div>
  </div>
</article>`
}

/**
 * 分组名 → 合法 HTML id，与 about.astro 的 groupDomId 严格一致：
 * 运行时同步会整块替换 aboutProjects，两侧 id 不同会让 aria-labelledby 指向失效。
 * 纯中文/空格分组名会被 slug 清空，用分组序号兜底保证 id 唯一且非空。
 */

export const projectGroupDomId = (title: string, index: number) => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `proj-${index}${slug ? `-${slug}` : ''}`
}

/** 关于页项目区（按分组聚合，与 about.astro 结构一致） */

export function renderAboutProjects(projects: ProjectEntry[]): string {
  const groups = groupProjects(projects)
  const sections = groups
    .map((group, index) =>
      group.items.length > 0
        ? `<section class="proj-section" aria-labelledby="${projectGroupDomId(group.title, index)}">
  <div class="proj-section__head">
    <h2 class="proj-section__label" id="${projectGroupDomId(group.title, index)}">${escapeHtml(group.title)}</h2>
    <p class="proj-section__desc">${escapeHtml(group.description)}</p>
  </div>
  <div class="proj-grid">${group.items.map((item) => renderProject(item)).join('')}</div>
</section>`
        : '',
    )
    .join('')
  return sections
}

// ---------------------------------------------------------------------------
// 友链（/friends）
// ---------------------------------------------------------------------------

/** 卡片右上角的「活跃信号」小图标（与 friends.astro 的 SIGNAL_ICON 逐字一致） */

export async function aboutBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const posts = sortPosts(ctx.posts)
  const postCount = posts.length
  const firstYear = posts.reduce((min, post) => {
    const year = Number(toShanghaiParts(toDate(post.data.date))?.year ?? NaN)
    return year && year < min ? year : min
  }, currentYearShanghai())
  const about = getAboutData(ctx.settings)
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/about'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    aboutProfile: renderAboutProfile(about, postCount, firstYear),
    aboutSkills: renderAboutSkills(about.skills),
    aboutProjects: renderAboutProjects(ctx.projects),
  }
}

/**
 * 历史链接 → 现行规范路径的 301 映射。
 *
 * 两种历史形态：
 * 1. `/posts/{id}` —— 最早的纯 ID 链接；
 * 2. `/posts/{分类名}/{id}` —— 改用「分类标识」前的中文分类名链接
 *    （同一篇文章现在的规范路径是 `/posts/{slug}/{id}`）。
 *
 * Astro 静态输出（无 adapter）不会执行 getStaticPaths 里的 redirect，所以旧链接在
 * 构建产物中是一份完整页面；真正的 301 只能由「实际负责返回 HTML 的这一层」来做。
 * @returns 命中旧链接形态且需要跳转时返回规范路径，其余情况返回 null
 */
