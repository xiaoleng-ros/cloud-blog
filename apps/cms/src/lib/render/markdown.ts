/**
 * Markdown 渲染（与 Astro 构建管线一致：插件顺序 + shiki 高亮）
 *
 * 渲染层按页面拆分的子模块之一；输出必须与拆分前逐字相同
 * （对照脚本：apps/cms/scripts/verify-render-parity.mjs）。
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { createHighlighter } from 'shiki'
import remarkLegacyShortcodes from 'cloud-blog/shared/remark-legacy-shortcodes.mjs'
import rehypeLegacyShortcodes from 'cloud-blog/shared/rehype-legacy-shortcodes.mjs'
import { createRehypeImgAttrs } from 'cloud-blog/shared/rehype-img-attrs.mjs'
import { buildMdSanitizeSchema, mdIframeHostGuard } from 'cloud-blog/shared/md-sanitize-schema.mjs'
import { site } from './config'

export const mdSanitizeSchema = buildMdSanitizeSchema(defaultSchema)

// 文章元数据/分类标签/日期处理：与前台博客共用同一份实现（消除两侧重复逻辑）

// 站点默认值（后台 SiteSettings 缺失时兜底）。原 site.config.json 已移除，统一在此维护。

export const SHIKI_LANGS = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'html',
  'css',
  'scss',
  'json',
  'bash',
  'sh',
  'shell',
  'python',
  'sql',
  'markdown',
  'yaml',
  'xml',
  'diff',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'dockerfile',
  'makefile',
  'graphql',
  'plaintext',
]

export let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null

export function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: SHIKI_LANGS,
    }).catch((err) => {
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

/** 反转 HTML 实体（用于把转义后的代码块文本还原为源码给 shiki） */

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 用 shiki 高亮代码块，输出与 Astro 构建一致的 astro-code 结构 */

export async function highlightCodeBlocks(html: string): Promise<string> {
  const highlighter = await getHighlighter()
  if (!highlighter) return html
  const pattern = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g
  let match
  let out = ''
  let lastIndex = 0
  while ((match = pattern.exec(html)) !== null) {
    out += html.slice(lastIndex, match.index)
    const lang = match[1]
    const text = decodeHtmlEntities(match[2])
    const loaded = highlighter.getLoadedLanguages() as string[]
    const actualLang = loaded.includes(lang) ? lang : 'plaintext'
    const highlighted = highlighter.codeToHtml(text, {
      lang: actualLang,
      theme: 'github-dark',
    })
    out += highlighted.replace(
      /^<pre[^>]*>/,
      `<pre class="astro-code github-dark" style="background-color:#24292e;color:#e1e4e8; overflow-x: auto;" tabindex="0" data-language="${actualLang}">`,
    )
    lastIndex = match.index + match[0].length
  }
  out += html.slice(lastIndex)
  return out
}

/** github-slugger 兼容的标题 slug（与 Astro 构建时的锚点 id 一致） */

export function createSlugger() {
  const seen = new Map<string, number>()
  return (text: string) => {
    let slug = String(text).toLowerCase().trim()
    // 去掉常见标点（保留中文、字母、数字、连字符）
    slug = slug.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/g, '')
    slug = slug.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug) slug = 'heading'
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count > 0 ? `${slug}-${count}` : slug
  }
}

export interface Heading {
  depth: number
  text: string
  slug: string
}

/**
 * 渲染 markdown 为 HTML，返回正文与标题列表（用于目录）。
 * @param md 原始 markdown 文本
 * @param altMap 图片 url → alt 文本映射，用于给正文里的 `![](url)` 补齐 alt（SEO/无障碍）
 */

export async function renderMarkdown(
  md: string,
  altMap: Map<string, string>,
): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = []
  const slugger = createSlugger()

  const collectHeadings = (tree: any) => {
    const visit = (node: any) => {
      if (node?.type === 'element' && /^h[23]$/.test(node.tagName)) {
        const text = node.children?.map((c: any) => (c?.type === 'text' ? c.value : '')).join('') ?? ''
        const slug = slugger(text)
        node.properties = node.properties ?? {}
        node.properties.id = slug
        headings.push({ depth: Number(node.tagName[1]), text, slug })
      }
      if (Array.isArray(node?.children)) node.children.forEach(visit)
    }
    visit(tree)
  }

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLegacyShortcodes)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeLegacyShortcodes)
    .use(rehypeRaw)
    .use(rehypeSanitize, mdSanitizeSchema)
    // 与 Astro 构建链对齐：schema 只剥掉非白名单 iframe 的 src，节点本身会留下一个
    // 空的 <iframe sandbox ...>；mdIframeHostGuard 负责把整个节点删掉。
    // shared/md-sanitize-schema.mjs 的注释明确要求两侧行为一致，此前这边漏挂。
    .use(mdIframeHostGuard)
    // createRehypeImgAttrs(map) 返回的是 **transformer**（tree => void），不是 plugin。
    // unified 的 .use() 会把参数当 plugin 调用一次（此时没有 tree 参数），
    // 直接把 transformer 传进去等于什么都没挂 —— 表现为正文图片既没有
    // loading/decoding/referrerpolicy，也没有用 Media.alt 回填空 alt。
    // 必须包一层惰性工厂，让 unified 在正确的时机拿到 transformer。
    .use(() => createRehypeImgAttrs(altMap))
    .use(() => collectHeadings)
    .use(rehypeStringify)
    .process(md)

  const html = await highlightCodeBlocks(String(file))
  return { html, headings }
}

// ---------------------------------------------------------------------------
// 区块渲染（与各 .astro 模板结构一一对应）
// ---------------------------------------------------------------------------

/** PostSummary.astro */
