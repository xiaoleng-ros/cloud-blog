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

/**
 * iframe 允许嵌入的 host 白名单（精确匹配或子域）。
 * 全仓 grep 无任何现存 iframe 嵌入：博客音乐播放器是 fetch + <audio> 自研实现
 * （Meting API host：meting.mikus.ink），不经过 iframe，净化规则不会影响它；
 * 这里保留音乐/常见视频平台的官方嵌入 host，供后台作者在正文里手动嵌歌单/视频。
 */
export const MD_IFRAME_HOSTS = [
  'music.163.com', // 网易云官方外链播放器
  'meting.mikus.ink', // 音乐播放器（Meting）实际 host
  'player.bilibili.com', // B 站官方外链播放器
  'www.youtube.com',
  'youtube.com',
];

/** iframe src 必须是白名单 host 的绝对 http(s) 地址；非白名单 host 的 src 会被净化器剥掉 */
export const MD_IFRAME_SRC_PATTERN = new RegExp(
  '^https?://(?:' +
    MD_IFRAME_HOSTS.map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
    ')(?:[/?#:]|$)',
  'i',
);

export const MD_EXTRA_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'loading', 'decoding', 'width', 'height', 'style'],
  // src 用正则限定 host：hast-util-sanitize 对 [name, ...allowed] 形态按允许值列表校验，
  // 非白名单 iframe 的 src 会被剥掉；整节点丢弃由 astro.config 挂的 mdIframeHostGuard 兜住。
  iframe: [
    ['src', MD_IFRAME_SRC_PATTERN],
    'width',
    'height',
    'title',
    'loading',
    'frameBorder',
    'allow',
    'allowFullScreen',
    'sandbox',
    'referrerpolicy',
  ],
  video: ['src', 'poster', 'controls', 'loop', 'muted', 'preload', 'width', 'height'],
  audio: ['src', 'controls', 'loop', 'muted', 'preload'],
  source: ['src', 'type', 'srcSet'],
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

/** 客户端兜底净化需要按 URL 语义校验的属性（DOM 小写名）；srcset/formaction 明确纳入 */
export const MD_URL_ATTRIBUTES = [
  'href',
  'src',
  'srcset',
  'formaction',
  'action',
  'cite',
  'longdesc',
  'poster',
];

const camelToHtmlAttr = (name) => {
  const lower = name.toLowerCase();
  if (lower === 'classname') return 'class';
  if (lower === 'htmlfor') return 'for';
  return lower;
};

/** 把 defaultSchema + 本文件扩展合并成净化器最终用的 attributes（工厂与列表导出共用这一份派生） */
const mergedAttributes = (defaultSchema) => ({
  ...defaultSchema?.attributes,
  '*': [...(defaultSchema?.attributes?.['*'] ?? []), 'className'],
  ...MD_EXTRA_ATTRIBUTES,
});

const flattenAttrNames = (definitions) =>
  [...new Set(
    (definitions ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : Array.isArray(entry) ? entry[0] : null))
      .filter(Boolean)
      .map(camelToHtmlAttr),
  )];

/**
 * @param defaultSchema 调用方从自己的 rehype-sanitize 依赖里取到的默认白名单
 */
export const buildMdSanitizeSchema = (defaultSchema) => ({
  ...defaultSchema,
  tagNames: [...(defaultSchema?.tagNames ?? []), ...MD_EXTRA_TAGS],
  attributes: mergedAttributes(defaultSchema),
  protocols: {
    ...defaultSchema?.protocols,
    ...MD_EXTRA_PROTOCOLS,
  },
  // iframe 统一注入最小 sandbox：只给 allow-scripts（不给 allow-same-origin，
  // 二者同开等于 sandbox 失效；仓库现存嵌入均为公开播放器、不依赖同域存储），
  // 再配 referrerpolicy=no-referrer 防止来源泄漏。required 仅在属性缺失时补默认值。
  required: {
    ...defaultSchema?.required,
    iframe: { sandbox: 'allow-scripts', referrerpolicy: 'no-referrer' },
  },
});

/**
 * 客户端兜底净化的纯数据白名单视图（Astro 构建期把 JSON 注入前台脚本）。
 * 与 buildMdSanitizeSchema 从同一份定义派生，避免两份白名单漂移。
 */
export const getMdSanitizeLists = (defaultSchema) => {
  const attributes = mergedAttributes(defaultSchema);
  return {
    tags: [...new Set([...(defaultSchema?.tagNames ?? []), ...MD_EXTRA_TAGS])],
    attributes: Object.fromEntries(
      Object.entries(attributes).map(([tag, defs]) => [camelToHtmlAttr(tag), flattenAttrNames(defs)]),
    ),
    urlAttributes: MD_URL_ATTRIBUTES,
    protocols: {
      ...defaultSchema?.protocols,
      ...MD_EXTRA_PROTOCOLS,
    },
    iframeHosts: MD_IFRAME_HOSTS,
    iframeSrcPattern: MD_IFRAME_SRC_PATTERN.source,
  };
};

/**
 * hast 树级 iframe 守卫：白名单之外的 iframe（含 src 已被剥掉的）整节点丢弃。
 * 纯函数、零依赖（直接遍历 hast 普通对象），供 app 侧作为 rehype 插件挂在
 * rehypeSanitize 之后；blog-render 侧未挂插件时，schema 的属性级正则仍会剥 src。
 */
export const mdIframeHostGuard = () => (tree) => {
  const cleanChildren = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.filter(
      (child) =>
        !(
          child.type === 'element' &&
          child.tagName === 'iframe' &&
          !(typeof child.properties?.src === 'string' && MD_IFRAME_SRC_PATTERN.test(child.properties.src))
        ),
    );
    for (const child of node.children) cleanChildren(child);
  };
  cleanChildren(tree);
};
