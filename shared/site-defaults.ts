/**
 * 站点内容的「离线兜底」默认值 —— 前后端共用唯一一份。
 *
 * 全站统一规则（唯一的默认值触发条件）：
 *   - 只有后台整体不可用（settings === null：请求失败、CMS 没起来）才取这里的值，
 *     让宕机时的前台仍是一个完整站点，而不是一片空白。
 *   - 后台可用、字段留空 → 前台就是空，绝不回退默认。
 *
 * 为什么必须集中在一处：blog 的 Astro 层与 cms 的 blog-render 注入层各自抄了一份字面量，
 * 删掉一边、另一边还在，于是出现「后台页脚群组明明是空的，前台却长出 QQ / 微信」的幽灵兜底。
 */
import { formatAboutLine, type NoteItem, type SkillItem } from './about-format';

/** 页脚一行：name 用于展示与找图标，href 空串表示纯文字标签 */
export interface FooterLinkItem {
  name: string;
  icon: string;
  href: string;
}

export interface OfflineHero {
  greeting: string;
  name: string;
  subtitle: string;
  bio: string;
  buttonLabel: string;
}

export interface OfflineFooter {
  subtitle: string;
  channels: FooterLinkItem[];
  groups: FooterLinkItem[];
}

export interface OfflineAbout {
  lead: string;
  paragraphs: string[];
  notes: NoteItem[];
  skills: SkillItem[];
}

export const OFFLINE_HERO: OfflineHero = {
  greeting: '嗨，我是',
  name: '段枫',
  subtitle: '又名 DUAN FENG · 爱折腾的创作者',
  bio: '别人叫我「AI 实践者」，我觉得自己只是个爱画画、爱写代码的孩子。把屏幕当画板，把代码当蜡笔，在这里画了 {count} 篇笔记。',
  buttonLabel: '浏览文章',
};

/**
 * 平台/名称 → 图标名（shared/icon-paths 里的键）。
 *
 * 键一律小写；查表前先把名称 trim + 小写，都没命中就用小写原名（图标表里没有 → 前台按纯文字渲染）。
 * 页脚与社交链接共用这一张：以前两张表各认各的，社交链接只认五个平台名，
 * 后台加了新平台前台直接整条消失。
 */
const ICON_ALIASES: Record<string, string> = {
  bilibili: 'bilibili',
  'b站': 'bilibili',
  哔哩哔哩: 'bilibili',
  douyin: 'douyin',
  抖音: 'douyin',
  youtube: 'youtube',
  x: 'x-platform',
  twitter: 'x-platform',
  rss: 'rss',
  qq: 'qq',
  wechat: 'wechat',
  微信: 'wechat',
  xiaohongshu: 'xiaohongshu',
  小红书: 'xiaohongshu',
  rednote: 'xiaohongshu',
  netease: 'netease-cloud-music',
  网易云: 'netease-cloud-music',
  网易云音乐: 'netease-cloud-music',
  github: 'github',
};

function resolveIconName(raw: string): string {
  const key = String(raw).trim().toLowerCase();
  return ICON_ALIASES[key] ?? key;
}

/** 页脚「名称」→ 图标名 */
export function footerIconFor(name: string): string {
  return resolveIconName(name);
}

/** 社交链接「平台」→ 图标名 */
export function socialIconFor(platform: string): string {
  return resolveIconName(platform);
}

export const OFFLINE_SOCIALS: Array<{ platform: string; href: string; label: string }> = [
  { platform: 'bilibili', href: 'https://space.bilibili.com/46377861', label: 'Bilibili' },
  { platform: 'douyin', href: 'https://www.douyin.com/user/self', label: '抖音' },
  { platform: 'youtube', href: 'https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg', label: 'YouTube' },
  { platform: 'x', href: 'https://x.com/shenfanlaogou', label: 'X' },
  { platform: 'rss', href: '/rss.xml', label: 'RSS 订阅' },
];

/** 群组没有兜底：后台不填，前台就不该出现任何群组标签 */
export const OFFLINE_FOOTER: OfflineFooter = {
  subtitle: 'AI · Code · Web',
  channels: [
    { name: 'Bilibili', icon: 'bilibili', href: 'https://space.bilibili.com/46377861' },
    { name: 'YouTube', icon: 'youtube', href: 'https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg' },
    { name: 'RSS', icon: 'rss', href: '/rss.xml' },
  ],
  groups: [],
};

export const OFFLINE_ABOUT: OfflineAbout = {
  lead: '关于我',
  // 与在线路径同源的 ==高亮== 记号，渲染交给 formatAboutLine，避免默认值成为唯一一段裸 HTML
  paragraphs: [
    '我喜欢==歪一点==的东西——太正了反而不真实。',
    '白天：==前端工程师 + 视觉设计师==，做正经的项目。',
    '晚上：==画涂鸦==、写小工具、做声音装置。',
    '梦想是让互联网上多一点==好玩的角落==。',
  ].map(formatAboutLine),
  notes: [
    { title: '坐标广州', subtitle: '1995 年生', color: 'yellow' },
    { title: '独立创作者', subtitle: '8 年经验', color: 'cyan' },
    { title: '一天三杯咖啡', subtitle: '（不是广告）', color: 'pink' },
  ],
  skills: [
    { label: 'HTML / CSS', sublabel: '画框搭的', value: 95, color: 'yellow' },
    { label: 'JavaScript', sublabel: '会耍魔术', value: 90, color: 'cyan' },
    { label: 'AI 工具', sublabel: '乱点乱用', value: 88, color: 'pink' },
    { label: 'Astro', sublabel: '让人省点', value: 85, color: 'purple' },
    { label: '视觉设计', sublabel: '爱涂爱画', value: 82, color: 'yellow' },
  ],
};
