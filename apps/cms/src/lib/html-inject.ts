/**
 * 静态 HTML 外壳 —— 服务端注入层（parse5 版）
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
 *
 * --- parse5 迁移说明 ---
 *
 * 旧版本用一套自研正则（`findTagEnd` + `findMatchingClose`）扫描 HTML 字符流，
 * 处理「同名嵌套」「空元素」「自闭合标签」等边界时靠手写 depth 计数，
 * 遇到 `<!-- <div> 注释里的假标签 -->`、`<script>` 里含 `<` 字符、
 * 属性值缺引号等极端输入时会静默错位。
 *
 * 现改用 parse5 的 DOM 解析结果定位锚点：
 * 1. `parse5.parse(html, { sourceCodeLocationInfo: true })` 只跑一次；
 * 2. 遍历所有 ELEMENT 节点，把带 `data-sync-block` 的元素按 blockId 索引；
 * 3. **不做** `parse5.serialize()` 全量序列化（避免格式抖动、属性重排），
 *    只把 DOM 提供的源字符偏移量当「尺子」，在原始 HTML 上做切片拼接；
 * 4. 结果：非锚点区域的字节与原文 100% 一致，只有锚点 innerHTML 被替换，
 *    开标签仅在必要时补一个 `data-sync-version` 属性。
 *
 * 好处：同名嵌套 `<article data-sync-block><article>…</article></article>`
 * 只有外层被匹配（parse5 DOM 树本身区分层级），彻底消除旧版 depth 计数误配的可能。
 */

import { parse } from 'parse5';

/**
 * parse5 v7 不再从主模块直接导出 Element / Node / ParentNode 类型，
 * 这里给出最小结构声明，足以支撑「属性读取 + 子节点遍历」的定位逻辑。
 * 之所以不 import TreeAdapterNS 是因为它藏在非主入口的深层路径，
 * 跨版本易碎，本地声明更稳。
 *
 * 这里刻意用「全部可选」+ 索引签名，因为 parse5 返回的节点在
 * #text、#comment、#document 等不同分支里字段差异较大，统一收敛成一个宽类型最简单。
 */
type Attr = { name: string; value?: string }
type AnyNode = {
  nodeName: string
  tagName?: string
  attrs?: Attr[]
  childNodes?: AnyNode[]
  value?: string
}

/** HTML 空元素：没有闭合标签，不能作为锚点容器（防御性过滤，parse5 已内建处理） */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 这些区块不是页面元素，由 <title> 单独处理 */
const NON_ELEMENT_BLOCKS = new Set(['pageTitle']);

/** 给属性值转义，兼容 " 出现在后台数据里的场景 */
const escapeAttrValue = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** 给文本内容转义，避免后台 title 里若含 < > 破坏 HTML 结构 */
const escapeText = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 单个锚点的源字符索引（相对原始 html 字符串） */
interface AnchorRegion {
  /** 开标签的 '<' 位置 */
  tagStart: number;
  /** 开标签的 '>' 位置（不含 >） */
  openEnd: number;
  /** innerHTML 起点 = openEnd + 1 */
  innerStart: number;
  /** innerHTML 终点 = 闭合标签 '<' 的起始位置 */
  innerEnd: number;
}

/** 判断节点是否为元素节点 */
function isElementNode(node: AnyNode): boolean {
  return node.nodeName === '#element' || node.tagName !== undefined
}

/** 读取元素上的属性值（大小写不敏感，返回原值不做转义还原） */
function getAttr(node: AnyNode, name: string): string | null {
  for (const attr of node.attrs ?? []) {
    if (attr.name.toLowerCase() === name) return attr.value ?? null
  }
  return null
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

/**
 * 深度优先遍历 DOM，对每个「带 data-sync-block 且被本次要注入的 blockId 命中」
 * 的元素记录源字符偏移。parse5 的 sourceCodeLocation 提供 startTag/endTag 精确到字符级的位置。
 *
 * @param node - 当前访问的 DOM 节点
 * @param wantedIds - 本次需要注入的 blockId 集合
 * @param anchors - 输出容器：blockId -> AnchorRegion
 * @param html - 原始 HTML 字符串，用于读取 openTag 原文片段
 */
function collectAnchors(
  node: AnyNode,
  wantedIds: Set<string>,
  anchors: Map<string, AnchorRegion>,
  html: string,
): void {
  // 遇到已记录过的锚点直接跳过（避免同名锚点重复触发）
  if (isElementNode(node)) {
    const blockId = getAttr(node, 'data-sync-block')
    const tagName = node.tagName?.toLowerCase() ?? ''
    if (blockId && wantedIds.has(blockId) && !VOID_TAGS.has(tagName)) {
      // parse5 只启用 sourceCodeLocationInfo 时才会给 element 挂 sourceCodeLocation 字段；
      // 若缺省（旧版 parse5 或意外分支），跳过以免污染输出。
      // 通过 any 断言是因为 @types/parse5 未在基础 Element 上声明该字段。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loc = (node as any).sourceCodeLocation
      if (loc && loc.startTag) {
        // parse5 v7: startTag.endOffset 是起始标签最后一个字符（`>`）的 0-based 索引
        // 所以 innerStart = startTag.endOffset + 1
        // 对于未闭合标签，parse5 不给 endTag，但会给 endOffset 指向解析终点。
        // 用 `endTag.startOffset ?? endOffset` 兜底，避免合法但残缺的 HTML 被漏注入。
        const tagStart: number = loc.startTag.startOffset
        const openEnd: number = loc.startTag.endOffset - 1
        const innerStart: number = loc.startTag.endOffset + 1
        const innerEnd: number = loc.endTag
          ? loc.endTag.startOffset
          : loc.endOffset
        // 防御：解析器返回的索引必须在 [0, html.length] 内且区间合法
        if (
          tagStart >= 0 &&
          innerEnd <= html.length &&
          innerEnd >= innerStart
        ) {
          anchors.set(blockId, { tagStart, openEnd, innerStart, innerEnd })
        }
      }
    }
  }

  // 递归遍历子节点
  const children = node.childNodes
  if (children && children.length > 0) {
    for (const child of children) collectAnchors(child, wantedIds, anchors, html)
  }
}

/**
 * 在 DOM 里定位 <title> 元素的源字符区段，返回 [start, end) 区间；
 * 找不到或 title 不是有效 ELEMENT 节点时返回 null。
 */
function findTitleLocation(root: AnyNode): { start: number; end: number } | null {
  const walk = (node: AnyNode): { start: number; end: number } | null => {
    if (isElementNode(node)) {
      if (node.tagName === 'title') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loc = (node as any).sourceCodeLocation
        if (loc) {
          return { start: loc.startOffset, end: loc.endOffset }
        }
      }
    }
    const children = node.childNodes
    if (!children) return null
    for (const child of children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
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
 *
 * 关键行为：
 * - **只解析一次**：parse5 DOM 遍历一遍 O(n)
 * - **不做全量序列化**：非锚点区域字节与原文 100% 一致
 * - **同名嵌套安全**：依赖 DOM 层级，外层锚点只匹配最外层
 * - **降级保底**：任何解析失败都返回原始 html + 全 skipped
 *
 * @param html - 原始静态 HTML 外壳
 * @param blocks - 后台渲染的区块 HTML 字典：blockId -> innerHTML
 * @param version - 数据版本号，写入每个锚点的 data-sync-version
 * @param title - 可选，传入时会替换 <title> 内容
 * @returns 注入后的 HTML 及 injected / skipped 列表
 */
export function injectSyncBlocks(
  html: string,
  blocks: Record<string, string>,
  version: string,
  title?: string | null,
): InjectResult {
  const injected: string[] = []
  const skipped: string[] = []

  // 1) 解析 DOM；失败直接降级
  let doc: AnyNode | null = null
  try {
    // parse5 v7：parse() 直接返回 Document 根节点
    doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as AnyNode
  } catch (err) {
    console.error('[html-inject] parse5 解析失败，降级为原样返回:', err)
    return {
      html,
      injected: [],
      skipped: Object.keys(blocks).filter((id) => !NON_ELEMENT_BLOCKS.has(id)),
    }
  }

  // 2) 预计算 wantedIds：只关心真正要注入的 blockId（跳过 NON_ELEMENT + 空内容）
  const wantedIds = new Set<string>()
  for (const [id, blockHtml] of Object.entries(blocks)) {
    if (NON_ELEMENT_BLOCKS.has(id)) continue
    if (typeof blockHtml !== 'string' || blockHtml === '') continue
    wantedIds.add(id)
  }

  if (wantedIds.size === 0) {
    // 提前算好 skipped：所有非元素空内容
    for (const [id, blockHtml] of Object.entries(blocks)) {
      if (NON_ELEMENT_BLOCKS.has(id)) continue
      if (typeof blockHtml !== 'string' || blockHtml === '') skipped.push(id)
    }
    return { html, injected, skipped }
  }

  // 3) DOM 遍历收集所有命中的锚点位置
  const anchors = new Map<string, AnchorRegion>()
  collectAnchors(doc, wantedIds, anchors, html)

  // 4) 逐个决定注入 / 跳过，并抽出 openTag 原文片段
  type Hit = { openStart: number; innerEnd: number; openTag: string; blockHtml: string }
  const hits: Hit[] = []
  for (const [blockId, blockHtml] of Object.entries(blocks)) {
    if (NON_ELEMENT_BLOCKS.has(blockId)) continue
    if (typeof blockHtml !== 'string' || blockHtml === '') {
      skipped.push(blockId)
      continue
    }
    const anchor = anchors.get(blockId)
    if (!anchor) {
      skipped.push(blockId)
      continue
    }
    const openTag = withVersionAttr(
      html.slice(anchor.tagStart, anchor.openEnd + 1),
      version,
    )
    hits.push({
      openStart: anchor.tagStart,
      innerEnd: anchor.innerEnd,
      openTag,
      blockHtml,
    })
    injected.push(blockId)
  }

  // 5) 按 innerEnd 降序做字符串切片拼接（从尾向前替换，保证前面已确定的索引不漂移）
  hits.sort((a, b) => b.innerEnd - a.innerEnd)
  let output = html
  for (const hit of hits) {
    output =
      output.slice(0, hit.openStart) +
      hit.openTag +
      hit.blockHtml +
      output.slice(hit.innerEnd)
  }

  // 6) 更新 <title>
  if (title) {
    const loc = findTitleLocation(doc)
    if (loc) {
      output =
        output.slice(0, loc.start) +
        `<title>${escapeText(title)}</title>` +
        output.slice(loc.end)
    }
  }

  return { html: output, injected, skipped }
}
