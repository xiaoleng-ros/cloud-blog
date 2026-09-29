import { withPayload } from '@payloadcms/next/withPayload'

/**
 * @type {import('next').NextConfig}
 *
 * ⚠️ dev 模式关闭 StrictMode 的原因：
 *   Payload Admin 是巨型 React 应用（Monaco Editor、TanStack Table、React Flow 等），
 *   StrictMode 会让每个组件在开发模式双渲染，本地 /admin 首次编译慢 2-3 倍。
 *   生产构建走 next build，StrictMode 只影响 dev，不影响生产。
 *   如果确实想跑 StrictMode 排查竞态/副作用 bug，把下行改回 true 即可。
 */
const nextConfig = {
  reactStrictMode: false,
  // cloud-blog/shared/* 是仓库内的 TS 源码（file: 依赖），必须交给 SWC 转译，
  // 否则 Next 默认跳过 node_modules 会导致构建期无法解析 .ts 源码。
  transpilePackages: ['cloud-blog'],
  // 注意：不需要 rewrites，静态博客文件由 src/app/[[...path]]/route.ts 提供
}

export default withPayload(nextConfig)
