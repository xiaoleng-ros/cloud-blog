// Harden post-content images:
// - referrerpolicy="no-referrer" bypasses image-host hotlink protection (防盗链)
// - loading="lazy" / decoding="async" avoid eager-loading remote images and reduce jank
// - alt：如作者在 markdown 里写了 `![alt](url)`，保留；否则按 altMap 用 url 反查 Media.alt 补齐
//
// 两个入口：
// - 默认导出 rehypeImgAttrs：使用「模块级全局 altMap」（同步入口通过 setAltMap 更新）
// - createRehypeImgAttrs(map)：工厂版，闭包绑定指定 map（blog-render 每次渲染时调用，避免共享状态串味）
const visit = (node, fn) => {
  if (!node) {
    return;
  }

  if (node.type === 'element') {
    fn(node);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, fn);
    }
  }
};

/** 模块级全局 altMap：url → alt 文本 */
let globalAltMap = new Map();

/**
 * 设置全局 altMap（url → alt）。
 * 前台 Astro loader 拉取 Media 数据后调用一次，供默认导出的 rehypeImgAttrs 使用。
 * @param {Map<string,string> | Record<string,string>} map 图片 URL 到替代文本的映射
 */
export function setAltMap(map) {
  globalAltMap = map instanceof Map ? map : new Map(Object.entries(map ?? {}));
}

/** 读取当前全局 altMap（诊断/测试用） */
export function getAltMap() {
  return globalAltMap;
}

/** 遍历 img 节点，按给定 map 或全局 map 补齐 alt */
function applyImgAttrs(tree, altMap) {
  const lookup = altMap && altMap.size > 0 ? altMap : globalAltMap;
  visit(tree, (node) => {
    if (node.tagName !== 'img') {
      return;
    }

    node.properties = node.properties ?? {};
    node.properties.referrerPolicy = 'no-referrer';
    node.properties.loading ??= 'lazy';
    node.properties.decoding ??= 'async';

    // alt 补齐策略：
    // 1) markdown 里 `![alt](url)` 显式写了非空 alt → 保留（remark 会转成 properties.alt = "文本"）
    // 2) 无 alt 或空 alt（markdown 的 `![](url)` 语法默认就是空） → 用 url 反查 Media.alt
    // 3) 都拿不到 → 保持空字符串，保证属性存在（比无属性对搜索引擎更友好）
    const existingAlt = node.properties.alt;
    const hasExplicitAlt = typeof existingAlt === 'string' && existingAlt.length > 0;
    if (!hasExplicitAlt) {
      const src = node.properties.src;
      if (typeof src === 'string' && lookup.has(src)) {
        node.properties.alt = lookup.get(src);
      } else {
        node.properties.alt = '';
      }
    }
  });
}

/** 工厂版：闭包绑定指定 map。blog-render 每次渲染时用，避免污染全局。 */
export function createRehypeImgAttrs(altMap) {
  return (tree) => {
    applyImgAttrs(tree, altMap);
  };
}

/** 默认导出：使用全局 altMap。Astro markdown 管线走这个（构建期通过 setAltMap 注入）。 */
export default function rehypeImgAttrs() {
  return (tree) => {
    applyImgAttrs(tree);
  };
}
