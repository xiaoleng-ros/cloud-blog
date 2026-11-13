/**
 * 友链页区块
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { FriendEntry } from '../blog-sync'
import { safeHref } from 'cloud-blog/shared/html-safety'
import { friendColorOf } from 'cloud-blog/shared/friend-colors'
import { iconInnerMarkup } from 'cloud-blog/shared/icon-paths'
import { footerBlocks, renderMorePanel, renderNavLinks } from './blocks-home'
import type { SyncData } from './config'
import { site } from './config'
import { escapeAttr, escapeHtml } from './util'

export const FRIEND_SIGNAL_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="3" y="13" width="3.4" height="7.6" rx="1.2"/><rect x="9.3" y="9" width="3.4" height="11.6" rx="1.2"/><rect x="15.6" y="4.4" width="3.4" height="16.2" rx="1.2"/></svg>'

/** 空态里那颗心（与 friends.astro 用同一个 Icon name，路径取自共享图标表） */

export const FRIEND_EMPTY_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconInnerMarkup('heart')}</svg>`

/** 单张友链项（结构与 friends.astro 保持一致，class 名一一对应） */

export function renderFriendCard(friend: FriendEntry): string {
  // 两条渲染链路都再过一次协议白名单：后台校验只覆盖新写入的数据，
  // 早期手工灌库的记录可能是任意字符串
  const href = safeHref(friend.url, '#')
  const avatar = friend.avatar ? safeHref(friend.avatar, '') : ''
  const initial = Array.from(friend.name.trim())[0] ?? '?'
  // 首字常驻 + 图片叠加：头像链接失效时 onerror 把 img 摘掉，露出的是首字而不是裂图
  const avatarInner =
    `<span class="friend-item__initial" aria-hidden="true">${escapeHtml(initial)}</span>` +
    (avatar
      ? `<img src="${escapeAttr(avatar)}" alt="" width="52" height="52" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />`
      : '')
  const memo = friend.description ? `<span class="friend-item__memo">${escapeHtml(friend.description)}</span>` : ''
  // 卡片配色与前台共用同一份散列：同一站名在两条链路上必须同色，
  // 否则后台改一次友链，页面上的卡片会集体换色
  const color = friendColorOf(friend.name)

  return `<li class="friend-item" style="--card-bg:${escapeAttr(color.bg)};--card-fg:${escapeAttr(color.fg)}">
  <a class="friend-item__link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${friend.note ? ` title="${escapeAttr(friend.note)}"` : ''}>
    <span class="friend-item__avatar">${avatarInner}</span>
    <span class="friend-item__text">
      <span class="friend-item__name">${escapeHtml(friend.name)}</span>${memo}
    </span>
    <span class="friend-item__mark" aria-hidden="true">${FRIEND_SIGNAL_ICON}</span>
  </a>
</li>`
}

/**
 * 友链列表区块：所有友链平铺成一个网格，不按 group 分区。
 *
 * 与 friends.astro 保持同一套结构（ul.friend-items > li.friend-item），
 * 站长不需要分组 —— 后台的 group 字段仍保留，但前台不再据此切区块，
 * 所以不会出现「佬们 / 朋友们」这类分组标题。
 */

export function renderFriends(friends: FriendEntry[]): string {
  if (friends.length === 0) {
    return `<div class="friend-empty">
  <span class="friend-empty__icon" aria-hidden="true">${FRIEND_EMPTY_ICON}</span>
  <p class="friend-empty__title">还没有友链</p>
  <p class="friend-empty__hint">想交换的话，在下面留言，或者发邮件给我。</p>
</div>`
  }

  // 不分组：所有友链平铺成一个网格，与 friends.astro 同结构。
  // group 字段仍留在后台（将来真想分区再启用），但前台不再按它切区块。
  return `<ul class="friend-items">${friends.map((item) => renderFriendCard(item)).join('')}</ul>`
}

/** /friends 页区块 */

export async function friendsBlocks(ctx: SyncData): Promise<Record<string, string | null>> {
  const settings = ctx.settings
  const siteName = settings?.siteName ?? site.name

  return {
    brandName: siteName,
    navLinks: renderNavLinks(ctx.nav, '/friends'),
    morePanel: renderMorePanel(ctx.morePanel),
    ...footerBlocks(settings),
    friendsList: renderFriends(ctx.friends),
    // 页头计数：后台增删友链后无需重建静态外壳也能更新
    friendsCount: `共 ${ctx.friends.length} 位邻居`,
  }
}

// ---------------------------------------------------------------------------
// 各页面 blocks 组装
// ---------------------------------------------------------------------------
