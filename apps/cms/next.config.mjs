import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // 后台管理路径直接透传给 Payload（不需要重写）
      { source: '/admin/:path*', destination: '/admin/:path*' },
      { source: '/api/:path*', destination: '/api/:path*' },
      // 前台动态页面：Astro 未生成静态文件的回退到 Next.js 渲染
      // 注意：/posts/*、/notes/*、/tags/*、/categories/* 由 Astro 静态生成，无需在此处理
      {
        source: '/:path((?!posts|notes|tags|categories|blog|admin|api|_next|cloud-icons)[^/]*)',
        destination: '/',
      },
    ]
  },
}

export default withPayload(nextConfig)
