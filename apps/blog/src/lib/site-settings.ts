/**
 * 站点设置接入模块
 *
 * 从 Payload 后台的「站点设置」Global 读取配置（站点信息/导航/社交/Hero 文案）。
 *
 * 全站统一规则：**后台填了才显示**。字段留空就返回空串 / 空数组，由模板条件渲染省略；
 * 只有后台整体拉取失败（settings === null）才使用 shared/site-defaults 的离线兜底，
 * 以免 CMS 宕机把站点清空。
 * 模块级缓存：整个构建/开发过程只请求一次后台。
 */
import { fetchNavItems, fetchSiteSettings } from './payload-api';
import { safeHref } from 'cloud-blog/shared/html-safety';
import {
  footerIconFor,
  OFFLINE_ABOUT,
  OFFLINE_FOOTER,
  OFFLINE_HERO,
  OFFLINE_SOCIALS,
  socialIconFor,
  type FooterLinkItem,
} from 'cloud-blog/shared/site-defaults';

/** 后台站点设置数据的结构（对应 SiteSettings Global，扁平字段） */
export interface SiteSettingsData {
  siteName?: string;
  siteDescription?: string;
  siteAuthor?: string;
  githubUser?: string;
  githubRepo?: string;
  neteasePlaylistId?: string;
  greeting?: string;
  name?: string;
  subtitle?: string;
  bio?: string;
  buttonLabel?: string;
  /** 社交链接：textarea 字符串，每行一条「平台 链接」 */
  socials?: string;
  /** 页脚：副标题与链接/群组（textarea 字符串） */
  footerSubtitle?: string;
  footerChannels?: string;
  footerGroups?: string;
  /** 页脚：ICP 备案号 */
  siteIcp?: string;
  /** 关于页：标题/正文/便签/技能（textarea 字符串） */
  aboutLead?: string;
  aboutParagraphs?: string;
  aboutNotes?: string;
  skills?: string;
}

// 站点设置模块级缓存：同一构建/开发会话内重复调用不会每次都请求后台。
// TTL 过期后重新拉取，兼顾实时性与带宽。后台不可用时返回 null 并保留过期缓存作为降级。
const SETTINGS_CACHE_TTL = 60_000;
let settingsCache: { data: SiteSettingsData | null; ts: number } | null = null;

export async function getSiteSettings(): Promise<SiteSettingsData | null> {
  // 缓存未过期直接复用，避免同一页面多次请求
  if (settingsCache && Date.now() - settingsCache.ts < SETTINGS_CACHE_TTL) {
    return settingsCache.data;
  }
  try {
    const data = await fetchSiteSettings();
    settingsCache = { data, ts: Date.now() };
    return data;
  } catch {
    // 请求失败时保留过期缓存（比完全不可用更好）
    return settingsCache?.data ?? null;
  }
}

/** 导航项：后台「导航管理」Global 优先，缺失时回退默认四项 */
export async function getNavItems(): Promise<Array<{ href: string; label: string }>> {
  const items = await fetchNavItems();
  return items && items.length > 0
    ? items.filter((item) => item.href && item.label)
    : [
        { href: '/', label: '首页' },
        { href: '/notes/', label: '随笔' },
        { href: '/archive/', label: '归档' },
        { href: '/about/', label: '关于' },
      ];
}

/**
 * 把后台「社交链接」(textarea，每行「平台 链接」) 解析为结构化数组。
 * 平台名按 shared/site-defaults 的别名表找图标，认不出图标时前台显示纯文字（与页脚同一套规则）。
 */
function parseSocials(raw?: string): Array<{ platform: string; href: string }> {
  if (!raw) return [];
  const out: Array<{ platform: string; href: string }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.indexOf(' ');
    if (sp === -1) continue;
    const platform = trimmed.slice(0, sp).trim();
    const href = trimmed.slice(sp + 1).trim();
    // 协议白名单：javascript:/data: 等一律变成惰性链接，不进 href
    if (platform && href) out.push({ platform, href: safeHref(href, '#') });
  }
  return out;
}

/** Hero 文案：后台原样；仅后台不可用时用离线兜底 */
export async function getHero(): Promise<{
  greeting: string;
  name: string;
  subtitle: string;
  bio: string;
  buttonLabel: string;
}> {
  const settings = await getSiteSettings();
  if (settings === null) return { ...OFFLINE_HERO };
  return {
    greeting: settings.greeting ?? '',
    name: settings.name ?? '',
    subtitle: settings.subtitle ?? '',
    bio: settings.bio ?? '',
    buttonLabel: settings.buttonLabel ?? '',
  };
}

/** 社交链接：后台一行一条；后台留空则前台一个图标都不出 */
export interface SocialItem {
  platform: string;
  href: string;
  label: string;
  icon: string;
}

export async function getSocials(): Promise<SocialItem[]> {
  const settings = await getSiteSettings();
  const items =
    settings === null
      ? OFFLINE_SOCIALS
      : parseSocials(settings.socials).map((item) => ({ ...item, label: item.platform }));
  // 与页脚同规则：认不出图标的平台照样显示，只是没有图形（见 shared/icon-paths 的 hasIcon）
  return items
    .map((item) => ({ ...item, icon: socialIconFor(item.platform) }))
    .filter((item) => item.href);
}

/** 页脚链接/群组条目（name 用于展示与找图标，href 可为空表示纯文字标签） */
export type FooterItem = FooterLinkItem;

export interface FooterData {
  subtitle: string;
  channels: FooterItem[];
  groups: FooterItem[];
}

/**
 * 把后台「每行一条 名称 链接」的文本解析为页脚条目。
 * 链接为空时 href 为空串（前台渲染为纯文字标签）。
 */
function parseFooterLines(raw?: string | null): FooterItem[] {
  if (!raw) return [];
  const out: FooterItem[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.lastIndexOf(' ');
    if (sp === -1) {
      // 只有名称没有链接 → 纯文字标签
      out.push({ name: trimmed, icon: footerIconFor(trimmed), href: '' });
      continue;
    }
    const name = trimmed.slice(0, sp).trim();
    const href = trimmed.slice(sp + 1).trim();
    // 协议不合法时归为空串：前台本来就按「无链接 → 纯文字标签」渲染
    if (name) out.push({ name, icon: footerIconFor(name), href: safeHref(href, '') });
  }
  return out;
}

/** 页脚内容：后台原样（链接/群组各按行解析），仅后台不可用时用离线兜底 */
export async function getFooter(): Promise<FooterData> {
  const settings = await getSiteSettings();
  if (settings === null) {
    return { subtitle: OFFLINE_FOOTER.subtitle, channels: OFFLINE_FOOTER.channels, groups: OFFLINE_FOOTER.groups };
  }
  return {
    subtitle: settings.footerSubtitle ?? '',
    channels: parseFooterLines(settings.footerChannels),
    groups: parseFooterLines(settings.footerGroups),
  };
}

/** 关于页条目类型与解析统一走 shared/about-format（后台预览同一份实现） */
export type { NoteItem, SkillItem } from 'cloud-blog/shared/about-format';
import {
  parseNotes,
  parseSkills,
  splitAboutParagraphs,
  type NoteItem,
  type SkillItem,
} from 'cloud-blog/shared/about-format';

export interface AboutData {
  lead: string;
  paragraphs: string[];
  notes: NoteItem[];
  skills: SkillItem[];
}

/**
 * 关于页内容：后台原样，仅后台不可用时用离线兜底。
 * paragraphs 为「==记号== → 高亮 span」的安全 HTML；notes/skills 兼容 JSON 与旧竖线文本。
 */
export async function getAboutContent(): Promise<AboutData> {
  const settings = await getSiteSettings();
  if (settings === null) {
    return {
      lead: OFFLINE_ABOUT.lead,
      paragraphs: OFFLINE_ABOUT.paragraphs,
      notes: OFFLINE_ABOUT.notes,
      skills: OFFLINE_ABOUT.skills,
    };
  }
  return {
    lead: settings.aboutLead ?? '',
    paragraphs: splitAboutParagraphs(settings.aboutParagraphs),
    notes: parseNotes(settings.aboutNotes),
    skills: parseSkills(settings.skills),
  };
}