/**
 * 静态 HTML 外壳 —— 服务端注入层
 *
 * 背景：博客前台是 Astro 静态产物（构建时机可能早于/落后于后台数据），
 * 如果直接把静态 HTML 返回给浏览器，首屏就会出现「先显示构建时的旧文案，
 * 再被 /api/blog-sync 改成后台最新数据」的闪烁。
 *
 * 做法：在响应 HTML 之前，用 blog-render 渲染出当前后台数据对应的区块，
 * 直接替换静态外壳里对应锚点的内容，让**第一次绘制就是最新数据**。
 * 客户端轮询/SSE 只作为「页面已打开后后台又改了数据」的增量更新手段。
 *
 * 约定（重要）：区块 HTML = 锚点元素的 innerHTML。
 * 即 <div class="hero__card" data-sync-block="heroCard">…这里…</div>，
 * 渲染函数只返回「这里」的内容，不再自带外层容器（否则每同步一次就多套一层）。
 */

/** HTML 空元素：没有闭合标签，不能作为锚点容器 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 这些区块不是页面元素，由 <title> 单独处理 */
const NON_ELEMENT_BLOCKS = new Set(['pageTitle'])

const escapeAttrValue = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

const escapeText = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 从 from 开始找到当前标签的结束 '>'（跳过属性值里的引号内容） */
function findTagEnd(html: string, from: number): number {
  let quote = ''
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return i
  }
  return -1
}

/** 从 from 开始找与 tagName 配对的闭合标签起始下标（处理同名嵌套） */
function findMatchingClose(html: string, tagName: string, from: number): number {
  const re = new RegExp(`<(/?)${escapeRegExp(tagName)}(?=[\\s/>])`, 'gi')
  re.lastIndex = from
  let depth = 1
  let match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) return match.index
      continue
    }
    const end = findTagEnd(html, match.index)
    if (end === -1) return -1
    if (html[end - 1] !== '/') depth += 1
    re.lastIndex = end + 1
  }
  return -1
}

interface AnchorRegion {
  tagStart: number
  openEnd: number
  innerStart: number
  innerEnd: number
}

/** 定位 data-sync-block="id" 所在的元素，返回它的开标签与内容区间 */
function findAnchor(html: string, blockId: string): AnchorRegion | null {
  const attrIndex = html.indexOf(`data-sync-block="${blockId}"`)
  if (attrIndex === -1) return null

  const tagStart = html.lastIndexOf('<', attrIndex)
  if (tagStart === -1) return null

  const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(tagStart, attrIndex))
  if (!nameMatch) return null
  if (VOID_TAGS.has(nameMatch[1].toLowerCase())) return null

  const openEnd = findTagEnd(html, tagStart)
  if (openEnd === -1) return null
  if (html[openEnd - 1] === '/') return null

  const closeStart = findMatchingClose(html, nameMatch[1], openEnd + 1)
  if (closeStart === -1) return null
  if (closeStart <= openEnd) return null

  return { tagStart, openEnd, innerStart: openEnd + 1, innerEnd: closeStart }
}

/** 给开标签补上/更新 data-sync-version，供客户端判断「这个区块已经是该版本」 */
function withVersionAttr(openTag: string, version: string): string {
  const attr = `data-sync-version="${escapeAttrValue(version)}"`
  if (/data-sync-version="[^"]*"/i.test(openTag)) {
    return openTag.replace(/data-sync-version="[^"]*"/i, attr)
  }
  if (/\/>$/.test(openTag)) return openTag.replace(/\/>$/, `${attr} />`)
  return openTag.replace(/>$/, `${attr}>`)
}

export interface InjectResult {
  html: string
  /** 成功注入的区块 id */
  injected: string[]
  /** 外壳里找不到锚点、或区块内容为空而跳过的 id */
  skipped: string[]
}

/**
 * 把后台数据对应的区块注入静态 HTML 外壳。
 * 找不到锚点的区块会被跳过（例如构建时该区块为空、模板里根本没有这段 DOM），
 * 此时仍由客户端轮询兜底。
 */
export function injectSyncBlocks(
  html: string,
  blocks: Record<string, string>,
  version: string,
  title?: string | null,
): InjectResult {
  let output = html
  const injected: string[] = []
  const skipped: string[] = []

  for (const [blockId, blockHtml] of Object.entries(blocks)) {
    if (NON_ELEMENT_BLOCKS.has(blockId)) continue
    if (typeof blockHtml !== 'string' || blockHtml === '') {
      skipped.push(blockId)
      continue
    }

    const anchor = findAnchor(output, blockId)
    if (!anchor) {
      skipped.push(blockId)
      continue
    }

    const openTag = withVersionAttr(output.slice(anchor.tagStart, anchor.openEnd + 1), version)
    output =
      output.slice(0, anchor.tagStart) +
      openTag +
      blockHtml +
      output.slice(anchor.innerEnd)
    injected.push(blockId)
  }

  if (title) {
    output = output.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeText(title)}</title>`,
    )
  }

  return { html: output, injected, skipped }
}
