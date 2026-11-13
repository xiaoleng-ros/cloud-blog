/**
 * 站点设置读取：Hero / 社交 / 页脚 / 头像 / ICP
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import { safeHref } from 'cloud-blog/shared/html-safety'
import { parseFreeTextLines } from 'cloud-blog/shared/free-text-lines'
import {
  footerIconFor,
  OFFLINE_FOOTER,
  OFFLINE_HERO,
  OFFLINE_SOCIALS,
  socialIconFor,
} from 'cloud-blog/shared/site-defaults'
import { siteAge } from 'cloud-blog/shared/site-age'
import type { SyncData } from './config'
import { site } from './config'

export function parseSocials(raw?: string): Array<{ platform: string; href: string }> {
  if (!raw) return []
  // 与前台共用 shared/free-text-lines 解析器：按「最后一个空格」切分
  // （平台在前、链接在后）。旧实现按「第一个空格」切，平台名带空格时解析错位。
  return parseFreeTextLines(String(raw), '', false)
    .filter((i) => i.name && i.href)
    .map((i) => ({ platform: i.name, href: i.href }))
}

/**
 * Hero / 社交 / 页脚 / 关于的取值规则与前台 site-settings.ts 完全一致：
 * 后台可用时原样返回（字段留空就是空串/空数组，由渲染层省略该项），
 * 仅当后台整体不可用（settings === null）才使用 shared/site-defaults 的离线兜底。
 */

export function getHeroData(settings: Record<string, any> | null) {
  if (settings === null) return { ...OFFLINE_HERO }
  return {
    greeting: settings.greeting ?? '',
    name: settings.name ?? '',
    subtitle: settings.subtitle ?? '',
    bio: settings.bio ?? '',
  }
}

export function getSocials(settings: Record<string, any> | null) {
  const items =
    settings === null
      ? OFFLINE_SOCIALS
      : parseSocials(settings.socials).map((item) => ({ ...item, label: item.platform }))
  // 与页脚同规则：认不出图标的平台照样显示，只是没有图形
  return items.map((item) => ({ ...item, icon: socialIconFor(item.platform) })).filter((item) => item.href)
}

export function getFooterData(settings: Record<string, any> | null) {
  // 与前台共用 shared/free-text-lines：页脚允许「只有名称没有链接」（纯文字标签）
  const parseFooterLines = (raw?: string | null) =>
    parseFreeTextLines(raw, '', true)
      .filter((i) => i.name)
      .map((i) => ({
        name: i.name,
        icon: footerIconFor(i.name),
        href: i.href,
      }))

  if (settings === null) {
    return {
      subtitle: OFFLINE_FOOTER.subtitle,
      channels: OFFLINE_FOOTER.channels,
      groups: OFFLINE_FOOTER.groups,
    }
  }
  return {
    subtitle: settings.footerSubtitle ?? '',
    channels: parseFooterLines(settings.footerChannels),
    groups: parseFooterLines(settings.footerGroups),
  }
}

/** 精选封面占位色的色相（与 index.astro coverHue 一致） */

export function coverHue(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return 12 + (hash % 32)
}

// ---------------------------------------------------------------------------
// 图标渲染：与 Astro 的 Icon.astro 共用 shared/icon-paths 同一张表
// （以前两侧各抄一份，这份少了 archive / compass / spark / bookmark / mail 五个，
//   于是后台同步回来的区块里那几个图标会变成空白）
// ---------------------------------------------------------------------------

export function icpOf(settings: SyncData['settings'] | null | undefined): string {
  return settings?.siteIcp?.trim() ?? ''
}

/**
 * 页脚头像 / favicon：统一用构建期生成的小尺寸产物（optimize-site-icons.mjs），
 * 不引用后台 siteIcon 原图（实测 2.38MB PNG，会把首屏优化打穿）。
 * 与 Footer.astro / BaseLayout.astro 的静态侧保持同一口径；后台改图后需重新部署。
 *
 * ⚠️ 那些产物在 `apps/blog/dist/avatars/`，只有 `astro build` 之后才存在。
 * 开发环境没有 dist，返回写死路径就是裂图 —— dev 下回退后台「网站图标」（数据库真图），
 * 让本地也能看到自己的头像。
 */

export function avatarOf(settings: SyncData['settings'] | null | undefined): string {
  if (process.env.NODE_ENV === 'production') return '/avatars/avatar-80.webp'
  const icon = String(settings?.siteIcon ?? '').trim()
  return icon ? safeHref(icon, '/avatars/avatar.png') : '/avatars/avatar.png'
}

/**
 * 首页「站点运行时间」卡（锚点 index.astro 的 aside[data-sync-block="siteAge"]）。
 * 后台「网站创建时间」留空 → 返回 ''（清空区块，全站「填了才显示」一致）；
 * 数字按注入时刻算，页面脚本（SiteAge.astro）进页面后会用同一套算法再重算一遍。
 * 标记必须与 SiteAge.astro 的产物逐字一致，否则块替换会出现两套样式/结构。
 */
