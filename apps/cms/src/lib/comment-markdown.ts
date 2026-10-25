/**
 * 评论正文的 Markdown 渲染（读时渲染，不入库）。
 *
 * 为什么需要它：
 *   @waline/client 的 CommentCard 用 `innerHTML: e.comment.comment` 直接插入评论正文
 *   （见 waline.js 里 `Go=[innerHTML]` 与 `(0,J.createElementVNode)("div",{innerHTML:e.comment.comment})`）。
 *   也就是说客户端**从不自己渲染 Markdown** —— 官方 @waline/core 在返回数据前会做这一步：
 *   `if (services.markdown) result.comment = await services.markdown.render(result.comment)`。
 *   我们此前只存了原始 Markdown 原样回传，于是 `![](url)` 在页面上就是一串源码。
 *
 * 为什么读时渲染而不是写时渲染：
 *   存量评论（包括线上那条带图片的）库里存的是原始 Markdown，写时渲染只对新评论生效，
 *   老数据仍然坏着。读时渲染让所有历史评论一次性恢复正常，且不需要任何数据库迁移。
 *
 * 为什么用 processSync：
 *   normalizeComment 是同步函数，被列表/新增/更新多处复用。整条管线
 *   （remark-parse → gfm → rehype → rehype-raw → rehype-sanitize → stringify）都是同步的，
 *   用 processSync 就能保持调用方签名不变，不必把整条链路改成 async。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { buildMdSanitizeSchema } from 'cloud-blog/shared/md-sanitize-schema.mjs'

/**
 * 评论的净化白名单：以文章正文那份（buildMdSanitizeSchema）为底，再收紧。
 *
 * 收紧的理由：文章正文由站主自己写，评论是完全不可信的第三方输入。
 * 所以把 iframe / video / audio / source 这些能把外部内容拉进页面的标签摘掉，
 * 只留排版、图片、链接、代码这些评论真正需要的东西。
 */
const COMMENT_ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
  'q', 's', 'samp', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
])

const baseSchema = buildMdSanitizeSchema(defaultSchema)

const commentSchema = {
  ...baseSchema,
  tagNames: (baseSchema.tagNames ?? []).filter((tag: string) => COMMENT_ALLOWED_TAGS.has(tag)),
  attributes: {
    ...baseSchema.attributes,
    // span 走 `*` 就能拿到 class（shared 层已把 className 加进 `*`），
    // 这里显式补一次是为了让 img/a 之外的 class 也稳定存活（表情 <img class="wl-emoji">）。
    a: ['href', 'title', 'target', 'rel', 'className'],
    img: ['src', 'alt', 'title', 'loading', 'decoding', 'width', 'height', 'className'],
    // 不让评论里出现 style：正文 style 会带上 url()/expression 这类向量，
    // 而且评论也不需要自定义样式。
    td: ['colSpan', 'rowSpan'],
    th: ['colSpan', 'rowSpan'],
  },
  // 评论里不注入 iframe 的 required 默认值（iframe 已不在白名单里）
  required: {},
}

/**
 * GFM 的软换行转 <br>。
 *
 * 官方 Waline 的 markdown-it 配置是 `breaks: true`，所以用户敲一次回车就该换行。
 * remark 默认按 CommonMark 把单个换行当空格，不补这一层的话，
 * 多行评论会挤成一整段 —— 与官方观感不一致。
 *
 * 只处理段落内部的换行：代码块、行内代码由 mdast 的 text 节点区别对待，
 * 代码块里的 text 节点父级是 `code`，不在 paragraphs 里，天然不受影响。
 */
const remarkBreaks = () => (tree: any) => {
  const walk = (node: any) => {
    if (!Array.isArray(node?.children)) return
    const next: any[] = []
    for (const child of node.children) {
      if (
        node.type === 'paragraph' &&
        child?.type === 'text' &&
        typeof child.value === 'string' &&
        child.value.includes('\n')
      ) {
        const pieces = child.value.split('\n')
        pieces.forEach((piece: string, index: number) => {
          if (index > 0) next.push({ type: 'break' })
          if (piece) next.push({ type: 'text', value: piece })
        })
        continue
      }
      walk(child)
      next.push(child)
    }
    node.children = next
  }
  walk(tree)
}

/** 外链统一新窗口打开，并标 ugc/nofollow —— 与官方 DOMPurify 钩子一致 */
const rehypeCommentLinks = () => (tree: any) => {
  const visit = (node: any) => {
    if (node?.type === 'element' && node.tagName === 'a') {
      node.properties = node.properties ?? {}
      node.properties.target = '_blank'
      node.properties.rel = 'ugc nofollow noreferrer noopener'
    }
    if (node?.type === 'element' && node.tagName === 'img') {
      node.properties = node.properties ?? {}
      // 评论配图是可选的；懒加载 + 不发 referer，与正文图片同口径
      node.properties.loading = 'lazy'
      node.properties.decoding = 'async'
      node.properties.referrerPolicy = 'no-referrer'
    }
    if (Array.isArray(node?.children)) node.children.forEach(visit)
  }
  visit(tree)
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  // allowDangerousHtml 必须开：客户端在提交前就把 `:emoji:` 转成了
  // `<img class="wl-emoji" src="/waline-emojis/weibo/xxx.png">` 这样的 HTML，
  // 若把原始 HTML 当普通文本转义掉，用户发的表情会变成一串源码。
  // 真正的安全边界在下面的 rehype-sanitize —— 白名单之外一律剥掉。
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, commentSchema as any)
  .use(rehypeCommentLinks)
  .use(rehypeStringify)

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * 把评论的原始 Markdown 渲染成可直接塞进 innerHTML 的 HTML。
 *
 * 渲染失败时退化成「转义后的纯文本段落」：宁可少几个样式，
 * 也不能让一条格式异常的评论把整个评论列表打挂（客户端拿到 undefined
 * 就又是 `t.data is not iterable` 那种整块空白）。
 */
export function renderCommentMarkdown(markdown: string): string {
  const source = markdown ?? ''
  if (!source.trim()) return ''
  try {
    return String(processor.processSync(source)).trim()
  } catch {
    return `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`
  }
}

/** HTML 实体解码（命名 + 十进制 + 十六进制），rehype-stringify 会把 < > 写成 &#x3C; 这种 */
function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return named[body.toLowerCase()] ?? match
  })
}

/** 后台/摘要用：把 Markdown 渲染后取纯文本（去掉标签） */
export function commentToPlainText(markdown: string): string {
  return decodeEntities(renderCommentMarkdown(markdown).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
