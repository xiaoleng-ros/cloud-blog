/**
 * 渲染层基础工具：转义、日期、文章路径
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import type { MdEntry } from '../blog-sync'
import { getPostCategorySegment, toShanghaiParts } from 'cloud-blog/shared/post-utils'
import { site } from './config'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 属性值转义（用于 class 等） */

export const escapeAttr = escapeHtml

export const toDate = (value?: unknown): Date | undefined => (value ? new Date(String(value)) : undefined)

/** 当前年份（Asia/Shanghai），与前台 Astro 模板同口径，避免运行机 TZ 造成跨年一天错位 */

export const currentYearShanghai = () => Number(toShanghaiParts(new Date())?.year)

// ---------------------------------------------------------------------------
// 站点设置 / Hero / 社交 / 页脚（与前台 site-settings.ts 逻辑一致）
// ---------------------------------------------------------------------------

export const postCategoryName = (post: MdEntry): string => getPostCategorySegment(post)

/**
 * 文章详情页路径：/posts/{分类标识}/{数字ID}
 *
 * 末尾**不带**尾斜杠。EdgeOne CDN 会在函数之前把所有带尾斜杠的 URL 308 去斜杠，
 * 而它的 Location 头把 UTF-8 字节按 latin1 输出 —— `/posts/日常生活/46/` 会被跳到
 * `/posts/æ¥å¸¸çæ´»/46`（乱码）→ 404。不带斜杠的请求不触发这条 308。
 */

export const getPostPath = (post: MdEntry) => `/posts/${encodeURIComponent(postCategoryName(post))}/${String(post.id)}`

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** HTML 转义（用于所有动态文本） */
