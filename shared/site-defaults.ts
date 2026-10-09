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

/**
 * 「站点运行时间」的起始日期。
 *
 * 已接后台：真实来源是站点设置的 siteCreatedAt（后台留空则整块不渲染）。
 * 这个常量只在「后台整体不可用」时兜底，保证宕机时这块不至于空掉。
 */
export const PLACEHOLDER_SITE_SINCE = '2026-10-06';

/**
 * ICP 备案号的离线兜底 —— 默认留空。
 *
 * 与其他文案不同：备案号写错等于给网站引入合规问题，宁可空着也不猜。
 * 需要在无后台环境下看到这一块，把真实备案号填进来（或启动后台在「站点设置 → 网站配置」填）。
 */
export const OFFLINE_ICP = '豫ICP备2020031049-1';

export const OFFLINE_HERO: OfflineHero = {
  greeting: '嗨，我是',
  name: '云岫',
  subtitle: '又名 YUN XIU · 爱折腾的剪辑创作者',
  bio: '小冷的个人空间 · 记录剪辑、AI 与代码\nSystem.out.print("有些梦虽然遥不可及，但并不是不可能实现!");',
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
  mail: 'mail',
  邮箱: 'mail',
  邮件: 'mail',
  电子邮件: 'mail',
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
  { platform: 'bilibili', href: 'https://space.bilibili.com/1459419286', label: 'Bilibili' },
  { platform: 'douyin', href: 'https://www.douyin.com/user/self', label: '抖音' },
  { platform: 'github', href: 'https://github.com/xiaoleng-ros', label: 'GitHub' },
  { platform: '邮箱', href: 'mailto:1873048956@qq.com', label: '邮箱' },
  { platform: 'rss', href: '/rss.xml', label: 'RSS 订阅' },
];

/** 群组没有兜底：后台不填，前台就不该出现任何群组标签 */
export const OFFLINE_FOOTER: OfflineFooter = {
  subtitle: '剪辑 · AI · Code',
  channels: [
    { name: 'Bilibili', icon: 'bilibili', href: 'https://space.bilibili.com/1459419286' },
    { name: 'GitHub', icon: 'github', href: 'https://github.com/xiaoleng-ros' },
    { name: '邮箱', icon: 'mail', href: 'mailto:1873048956@qq.com' },
    { name: 'RSS', icon: 'rss', href: '/rss.xml' },
  ],
  groups: [],
};

export const OFFLINE_ABOUT: OfflineAbout = {
  lead: '关于我',
  // 与在线路径同源的 ==高亮== 记号，渲染交给 formatAboutLine，避免默认值成为唯一一段裸 HTML
  paragraphs: [
    '我喜欢==神秘感==——云雾之间。',
    '白天：每天起床==剪视频==。',
    '晚上：幻想==挣大钱==。',
    '梦想是想去看祖国的==大好河山==。',
  ].map(formatAboutLine),
  notes: [
    { title: '坐标成都', subtitle: '2003 年出生', color: 'yellow' },
    { title: '剪辑师', subtitle: '1 年经验', color: 'green' },
    { title: '内容创作者', subtitle: '挣大钱', color: 'purple' },
  ],
  skills: [
    { label: '剪辑', sublabel: '易学难入', value: 30, color: 'green' },
    { label: 'HTML / CSS', sublabel: '全靠 AI', value: 60, color: 'purple' },
    { label: 'AI 工具', sublabel: '听之任之', value: 75, color: 'pink' },
    { label: 'JavaScript', sublabel: '会点魔术', value: 65, color: 'yellow' },
  ],
};
