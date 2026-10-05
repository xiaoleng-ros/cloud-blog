import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  // Waline 服务端（ThinkJS）在运行时用动态 require 加载其 src/*，被打包器静态分析会碎，
  // 必须保持为 server external，交给 createRequire 在 node_modules 里原样解析。
  serverExternalPackages: ['@waline/vercel', 'thinkjs', 'think-model-postgresql', 'ip2region'],
  experimental: {
    // 悬停才预取动态路由。默认行为是「进入视口就预取」，侧栏 13 个链接会一次性把
    // dev 服务器打成并发按需编译（实测同时编译 4 个页面时单页耗时 21s）。
    //
    // 这是半个开关：它只把 process.env.__NEXT_DYNAMIC_ON_HOVER 烘进客户端包，
    // hover 时要真正把该链接的 fetchStrategy 升到 Full，还必须有 <Link unstable_dynamicOnHover>。
    // 判据在 next/dist/client/components/links.js:243 —— 两个条件同时为真才升级，缺一即空转。
    // 所以侧栏与多标签的 Link 都带上了该 prop（CustomNav.tsx / PageTab.tsx）。
    // 另注：next dev 里预取整体被禁用（app-dir/link.js:351 直接 return），这条只在生产生效。
    //
    // 注意：不要给后台加 staleTimes.dynamic（客户端路由缓存）。Payload 启动时会直接告警
    // "detected a non-zero value for the staleTimes.dynamic option ... may cause stale data
    // to load within the Admin panel"——后台列表数据就在 RSC 树里，缓存壳子等于缓存数据。
    // 实测它也确实没生效（重复导航仍每次发 RSC 请求）。
    dynamicOnHover: true,
  },
  // cloud-blog/shared/* 是仓库内的 TS 源码（file: 依赖），必须交给 SWC 转译，
  // 否则 Next 默认跳过 node_modules 会导致构建期无法解析 .ts 源码。
  transpilePackages: ['cloud-blog'],
  // Next 16 起 next build 默认 Turbopack，其项目根取本目录；cloud-blog 是指向仓库根的
  // file: 依赖，../../shared/* 落在根外会 module-not-found，必须显式上提根到 monorepo 根。
  turbopack: { root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..') },
  // 安全响应头：对全部路由（含 Payload 后台 /admin 与 /api）统一加，均为无副作用基线项：
  //   - nosniff：禁止 MIME 嗅探；Payload 各资源都带正确 Content-Type，不会被误判拦截。
  //   - Referrer-Policy：跨源只发 origin，收敛引用方信息泄露。
  //   - X-Frame-Options SAMEORIGIN：只允许同源页面把后台嵌进 iframe（防点击劫持）；
  //     后台与前台同源，不影响 Payload admin 自身的同页布局。
  // 说明：暂不强上 CSP —— 后台（vditor/lexical/内联样式与脚本）内联内容多，贸然加会碎掉界面；
  //       建议后续单独做 CSP 基线并按 nonce 方案灰度验证后再启用。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ]
  },
  // 注意：不需要 rewrites，静态博客文件由 src/app/[[...path]]/route.ts 提供
}

export default withPayload(nextConfig)
