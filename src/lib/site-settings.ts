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