/**
 * 文章正文净化白名单（Astro 构建链与 CMS blog-render 共用，两侧行为必须一致）。
 * GFM 默认基础上补齐 legacy 短代码与存量文章的标签/属性；
 * href/src 协议白名单挡住 javascript:/vbscript:，script/on* 事件属性一律丢弃。
 * 改动本文件必须同步回归测试：javascript:、实体伪装、属性注入三类样例。
 *
 * 为什么这里是「传入 defaultSchema 的工厂函数」而不是直接 import rehype-sanitize：
 * shared/ 通过 cloud-blog 包名被两个 app 引用，文件真实路径在仓库根，
 * 那里没有 node_modules —— 任何裸包 import 都会在运行时解析失败
 * （表现为 Astro 加载配置直接报错）。依赖只允许留在各 app 内部。
 */
export const MD_EXTRA_TAGS = [
  'details',
  'summary',
  'iframe',
  'figure',
  'figcaption',
  'mark',
  'sub',
  'sup',
  'video',
  'audio',
  'source',
];

export const MD_EXTRA_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'loading', 'decoding', 'width', 'height', 'style'],
  iframe: ['src', 'width', 'height', 'title', 'loading', 'frameBorder', 'allow', 'allowFullScreen'],
  video: ['src', 'poster', 'controls', 'loop', 'muted', 'preload', 'width', 'height'],
  audio: ['src', 'controls', 'loop', 'muted', 'preload'],
  source: ['src', 'type'],
  td: ['colSpan', 'rowSpan', 'style'],
  th: ['colSpan', 'rowSpan', 'style'],
  del: ['cite', 'datetime'],
  ins: ['cite', 'datetime'],
  time: ['datetime'],
};

export const MD_EXTRA_PROTOCOLS = {
  href: ['http', 'https', 'mailto', 'tel'],
  src: ['http', 'https'],
};

/**
 * @param defaultSchema 调用方从自己的 rehype-sanitize 依赖里取到的默认白名单
 */
export const buildMdSanitizeSchema = (defaultSchema) => ({
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...MD_EXTRA_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    ...MD_EXTRA_ATTRIBUTES,
  },
  protocols: {
    ...defaultSchema.protocols,
    ...MD_EXTRA_PROTOCOLS,
  },
});
