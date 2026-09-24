import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // cloud-blog/shared/* 是仓库内的 TS 源码（file: 依赖），必须交给 SWC 转译，
  // 否则 Next 默认跳过 node_modules 会导致构建期无法解析 .ts 源码。
  transpilePackages: ['cloud-blog'],
  // 注意：不需要 rewrites，静态博客文件由 src/app/[[...path]]/route.ts 提供
}

export default withPayload(nextConfig)
