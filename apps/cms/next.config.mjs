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
    // EdgeOne 云函数包有 128MiB 硬限额；turbopack 默认会往 .next/server 写 ~78MB
    // 服务端 source map（本地实测 675 个 .map），运行时与排障都用不到，关掉。
    serverSourceMaps: false,
    turbopackSourceMaps: false,
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
  // 全项目无人使用 next/image；置 unoptimized 后 EdgeOne 插件会跳过图像优化
  // loader 注入（见 @edgeone/opennextjs-pages 的 "images.unoptimized detected"），
  // 函数包里不再携带 sharp/图像优化运行时，行为零变化。
  images: { unoptimized: true },
  // Supabase CA 证书必须显式纳入文件追踪。
  //
  // 背景（2026-10-12 线上事故）：payload.config.ts 在严格 TLS 下用 readFileSync 读
  // certs/supabase-ca.pem 注入 pg 的 ssl.ca。readFileSync 的路径是运行时决定的，
  // Next 的文件追踪静态分析看不到它 → 证书不会进 .next/standalone →
  // 容器里读不到 → 又回到 "self-signed certificate in certificate chain"，
  // Payload 初始化失败、全站 500。outputFileTracingIncludes 是唯一可靠解法。
  outputFileTracingIncludes: {
    '/**': ['./certs/**/*.pem'],
  },
  // EdgeOne 云函数 128MiB 限额：把仅构建期/CLI 使用的工具链挡在文件追踪之外
  // （不进追踪 = 不进 standalone，比构建后删文件安全）。
  // 基线实测（2026-10-12，edgeone pages build 本地打包）：函数包 208MB，超限 80MB；
  // 下列排除合计裁掉 ~100MB，打包后约 108MB。
  //
  // ⚠️ 哈希符号链接坑（曾在 CI 翻车）：turbopack 会给图谱里的 externalized 包在
  // .next/standalone/apps/cms/.next/node_modules/ 下建 `<pkg>-<hash>` 符号链接，
  // 打包插件 onBuild 会对链接做 realpath 复制；若把这类包整包排除 → 链接变死链 →
  // realpath ENOENT 构建失败（2026-10-12 首次排除 drizzle-kit 时实际翻过车）。
  // 解法：buildCommand 末尾 `find .next -xtype l -delete` 先清死链，再交给插件打包。
  // （符号链接解引用后包内会有双份：drizzle-kit 本体 + 链接副本，共 ~36MB。）
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@esbuild/**',
      'node_modules/esbuild/**',
      'node_modules/esbuild-register/**',
      'node_modules/next/dist/compiled/@vercel/og/**',
      // Next 内嵌的图像优化原生库（next/node_modules/@img，glibc+musl 双份 ~37MB）。
      // images.unoptimized=true → next 自带 image-optimizer 永不加载 sharp，运行时零引用；
      // payload 的 sharp 走顶层 node_modules/sharp，不受影响。
      'node_modules/next/node_modules/@img/**',
      // musl（Alpine）专用原生二进制 ~26MB：EdgeOne Node Functions 跑官方 Node 构建
      // （文档指定的 20.18.0 / 22.11.0 均为 glibc 发行版），运行时 detect-libc 判定
      // glibc，只可能加载 linux-x64-gnu 变体；musl 变体在该运行时永远用不到。
      // （npm 因 @img/@libsql 的 package.json 不区分 libc，会把两套都装上。）
      'node_modules/@img/sharp-libvips-linuxmusl-x64/**',
      'node_modules/@img/sharp-linuxmusl-x64/**',
      'node_modules/@libsql/linux-x64-musl/**',
      // drizzle-kit 只在 dev（schema push / 迁移生成）用到：payload 的
      // requireDrizzleKit() 是惰性 createRequire，生产跑预生成 migrations 数组，
      // 从不调用它（@payloadcms/drizzle 的调用点全在 pushDevSchema / 迁移生成链路）。
      // 整包排除后其哈希死链由 buildCommand 的 find -xtype l -delete 清理。
      'node_modules/drizzle-kit/**',
    ],
    '/*': [
      'node_modules/@esbuild/**',
      'node_modules/esbuild/**',
      'node_modules/esbuild-register/**',
      'node_modules/next/dist/compiled/@vercel/og/**',
      'node_modules/next/node_modules/@img/**',
      'node_modules/@img/sharp-libvips-linuxmusl-x64/**',
      'node_modules/@img/sharp-linuxmusl-x64/**',
      'node_modules/@libsql/linux-x64-musl/**',
      'node_modules/drizzle-kit/**',
    ],
  },
  // 安全响应头：对全部路由（含 Payload 后台 /admin 与 /api）统一加，均为无副作用基线项：
  //   - nosniff：禁止 MIME 嗅探；Payload 各资源都带正确 Content-Type，不会被误判拦截。
  //   - Referrer-Policy：跨源只发 origin，收敛引用方信息泄露。
  //   - X-Frame-Options SAMEORIGIN：只允许同源页面把后台嵌进 iframe（防点击劫持）；
  //     后台与前台同源，不影响 Payload admin 自身的同页布局。
  //   - Strict-Transport-Security：EdgeOne 全站 HTTPS，声明一年内只走加密连接，
  //     挡掉首次访问时的协议降级（http:// 劫持/嗅探）。includeSubDomains 覆盖
  //     后台子域 cms.iceuu.com 与前台 blog.iceuu.icu 同族场景。
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
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
  // 注意：不需要 rewrites，静态博客文件由 src/app/[[...path]]/route.ts 提供
}

export default withPayload(nextConfig)
