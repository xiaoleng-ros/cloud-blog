/**
 * 跨项目导入的博客 Markdown 插件类型声明
 *
 * blog-render.tsx 从 apps/blog/src/lib/ 导入以下 .mjs 插件，
 * 这些文件无 TypeScript 类型声明，在此统一声明为 unified 的 Plugin 类型。
 *
 * 注意：此文件不能有顶层 import/export，否则 declare module 会被当作
 * 模块增强（augmentation）而非新模块声明（declaration），导致不生效。
 * 因此 import type 写在每个 declare module 内部。
 */

declare module '*/remark-legacy-shortcodes.mjs' {
  import type { Plugin } from 'unified'
  const plugin: Plugin
  export default plugin
}

declare module '*/rehype-legacy-shortcodes.mjs' {
  import type { Plugin } from 'unified'
  const plugin: Plugin
  export default plugin
}

declare module '*/rehype-img-attrs.mjs' {
  import type { Plugin } from 'unified'
  const plugin: Plugin
  export default plugin
}
