/**
 * 站点设置接入模块
 *
 * 从 Payload 后台的「站点设置」Global 读取配置（站点信息/导航/社交/Hero 文案），
 * 后台不可用时自动回退到本地 data/site.config.json 或组件内默认值。
 * 模块级缓存：整个构建/开发过程只请求一次后台。
 */
import { fetchNavItems, fetchSiteSettings } from './payload-api';

/** 后台站点设置数据的结构（对应 SiteSettings Global，扁平字段） */
export interface SiteSettingsData {
  siteName?: string;
  siteDescription?: string;
  siteAuthor?: string;
  githubUser?: string;
  githubRepo?: string;
  twikooEnvId?: string;
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
  /** 关于页：标题/正文/便签/技能（textarea 字符串） */
  aboutLead?: string;
  aboutParagraphs?: string;
  aboutNotes?: string;
  skills?: string;
}

// 注意：不缓存，每次渲染都实时请求后台，保证后台改动前台立即可见；
// 后台不可用时返回 null，由各调用方回退本地配置或默认值。
export async function getSiteSettings(): Promise<SiteSettingsData | null> {
  try {
    return await fetchSiteSettings();
  } catch {
    return null;
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
 * 平台支持：bilibili / douyin / youtube / x / rss
 */
export function parseSocials(raw?: string): Array<{ platform: string; href: string }> {
  if (!raw) return [];
  const out: Array<{ platform: string; href: string }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.indexOf(' ');
    if (sp === -1) continue;
    const platform = trimmed.slice(0, sp).trim();
    const href = trimmed.slice(sp + 1).trim();
    if (platform && href) out.push({ platform, href });
  }
  return out;
}

/** Hero 文案：优先后台，缺失时回退默认值 */
export async function getHero(): Promise<{
  greeting: string;
  name: string;
  subtitle: string;
  bio: string;
  buttonLabel: string;
}> {
  const settings = await getSiteSettings();
  return {
    greeting: settings?.greeting ?? '嗨，我是',
    name: settings?.name ?? '段枫',
    subtitle: settings?.subtitle ?? '又名 DUAN FENG · 爱折腾的创作者',
    bio:
      settings?.bio ??
      '别人叫我「AI 实践者」，我觉得自己只是个爱画画、爱写代码的孩子。把屏幕当画板，把代码当蜡笔，在这里画了 {count} 篇笔记。',
    buttonLabel: settings?.buttonLabel ?? '浏览文章',
  };
}

/** 图标名映射：把用户填的「名称」归一为 Icon.astro 可渲染的图标名 */
function footerIconFor(name: string): string {
  const iconMap: Record<string, string> = {
    Bilibili: 'bilibili',
    bilibili: 'bilibili',
    YouTube: 'youtube',
    youtube: 'youtube',
    RSS: 'rss',
    rss: 'rss',
    QQ: 'qq',
    qq: 'qq',
    微信: 'wechat',
    wechat: 'wechat',
  };
  return iconMap[name] ?? name.toLowerCase();
}

/** 页脚链接/群组条目（name 用于展示与找图标，href 可为空表示纯文字标签） */
export interface FooterItem {
  name: string;
  icon: string;
  href: string;
}

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
    if (name) out.push({ name, icon: footerIconFor(name), href });
  }
  return out;
}

/** 页脚内容：优先后台，缺失时回退现状默认值（与旧 Footer 硬编码一致） */
export async function getFooter(): Promise<FooterData> {
  const settings = await getSiteSettings();
  const channels = parseFooterLines(settings?.footerChannels);
  const groups = parseFooterLines(settings?.footerGroups);
  return {
    subtitle: settings?.footerSubtitle ?? 'AI · Code · Web',
    channels:
      channels.length > 0
        ? channels
        : [
            { name: 'Bilibili', icon: 'bilibili', href: 'https://space.bilibili.com/46377861' },
            { name: 'YouTube', icon: 'youtube', href: 'https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg' },
            { name: 'RSS', icon: 'rss', href: '/rss.xml' },
          ],
    groups:
      groups.length > 0
        ? groups
        : [
            { name: 'QQ 交流群', icon: 'qq', href: '' },
            { name: '微信交流群', icon: 'wechat', href: '' },
          ],
  };
}

/** 关于页技能环条目 */
export interface SkillItem {
  label: string;
  sublabel: string;
  value: number;
  color: 'yellow' | 'cyan' | 'pink' | 'purple';
}

/** 关于页便签条目 */
export interface NoteItem {
  title: string;
  subtitle: string;
  color: 'yellow' | 'cyan' | 'pink';
}

export interface AboutData {
  lead: string;
  paragraphs: string[];
  notes: NoteItem[];
  skills: SkillItem[];
}

/** 校验颜色是否在允许列表内，否则回退默认色 */
function safeSkillColor(color: string): SkillItem['color'] {
  const allowed = ['yellow', 'cyan', 'pink', 'purple'];
  return (color && allowed.includes(color) ? color : 'yellow') as SkillItem['color'];
}
function safeNoteColor(color: string): NoteItem['color'] {
  const allowed = ['yellow', 'cyan', 'pink'];
  return (color && allowed.includes(color) ? color : 'pink') as NoteItem['color'];
}

/** 按行解析技能环：每行「名称｜副标题｜数值｜颜色」 */
function parseSkills(raw?: string | null): SkillItem[] {
  if (!raw) return [];
  const out: SkillItem[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|').map((s) => s.trim());
    if (!parts[0]) continue;
    out.push({
      label: parts[0],
      sublabel: parts[1] ?? '',
      value: Math.min(100, Math.max(0, Number(parts[2]) || 0)),
      color: safeSkillColor(parts[3] ?? ''),
    });
  }
  return out;
}

/** 按行解析便签：每行「标题｜副文字｜颜色」 */
function parseNotes(raw?: string | null): NoteItem[] {
  if (!raw) return [];
  const out: NoteItem[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|').map((s) => s.trim());
    if (!parts[0]) continue;
    out.push({
      title: parts[0],
      subtitle: parts[1] ?? '',
      color: safeNoteColor(parts[2] ?? ''),
    });
  }
  return out;
}

/**
 * 关于页内容：优先后台，缺失时回退现状默认值（与旧 about.astro 硬编码一致）。
 * paragraphs 支持简单 HTML（如 marker-highlight）、notes/skills 用「分隔」结构化存储。
 */
export async function getAboutContent(): Promise<AboutData> {
  const settings = await getSiteSettings();
  const skills = parseSkills(settings?.skills);
  const notes = parseNotes(settings?.aboutNotes);
  const paragraphs = (settings?.aboutParagraphs ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    lead: settings?.aboutLead ?? '关于我',
    paragraphs:
      paragraphs.length > 0
        ? paragraphs
        : [
            '我喜欢<span class="marker-highlight">歪一点</span>的东西——太正了反而不真实。',
            '白天：<span class="marker-highlight">前端工程师 + 视觉设计师</span>，做正经的项目。<br />晚上：<span class="marker-highlight">画涂鸦</span>、写小工具、做声音装置。',
            '梦想是让互联网上多一点<span class="marker-highlight">好玩的角落</span>。',
          ],
    notes:
      notes.length > 0
        ? notes
        : [
            { title: '坐标广州', subtitle: '1995 年生', color: 'yellow' },
            { title: '独立创作者', subtitle: '8 年经验', color: 'cyan' },
            { title: '一天三杯咖啡', subtitle: '（不是广告）', color: 'pink' },
          ],
    skills:
      skills.length > 0
        ? skills
        : [
            { label: 'HTML / CSS', sublabel: '画框搭的', value: 95, color: 'yellow' },
            { label: 'JavaScript', sublabel: '会耍魔术', value: 90, color: 'cyan' },
            { label: 'AI 工具', sublabel: '乱点乱用', value: 88, color: 'pink' },
            { label: 'Astro', sublabel: '让人省点', value: 85, color: 'purple' },
            { label: '视觉设计', sublabel: '爱涂爱画', value: 82, color: 'yellow' },
          ],
  };
}