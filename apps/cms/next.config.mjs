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
  // 评论服务已切换为自写 waline-server.ts（pg 直连 wl_* 表），不再依赖 @waline/vercel。
  // 保留 ip2region 为 external：它有原生 .xdb 二进制数据文件，打包器静态分析会碎。
  //
  // 注：AWS SDK 不列在这里。它已由 @payloadcms/storage-s3 静态 import 进入主包
  // （CMS 能启动就证明它进了包），再改成 external 只会把解析时机挪到运行时、
  // 多一个失败点，没有收益。
  serverExternalPackages: ['ip2region'],
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
  //
  //
  // ⚠️ 千万不要往这里加 `./node_modules/**` 类的 glob（2026-10-22 构建事故）。
  // 本项目 apps/cms/package.json 有 `"cloud-blog": "file:../.."`，安装后
  // apps/cms/node_modules/cloud-blog 是指回仓库根的符号链接。一旦追踪 glob 的根
  // 落在 node_modules 上，nft 会顺着这个链接走回仓库根、再走进 apps/cms/node_modules，
  // 立刻自成一圈，Turbopack 直接报：
  //   'apps/cms/node_modules/cloud-blog' is a symlink causes that causes an infinite loop!
  // 表现为 `Failed to write app endpoint /_not-found/page` → 整个构建 FATAL。
  //
  // 曾为了「保险」把 @aws-sdk 和 @smithy 加进来，实测既无必要也有害：
  // 那版线上返回的是 `SignatureDoesNotMatch 403`（说明 SDK 已在包内、能连到端点），
  // 不是 `ERR_MODULE_NOT_FOUND`；而加 glob 后的构建直接失败，部署根本没发生。
  // AWS SDK 由 @payloadcms/storage-s3 静态 import 进入主包，追踪本就覆盖它。
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
  //   - Accept-CH：向浏览器声明后台需要 Sec-CH-Prefers-Color-Scheme 客户端提示。
  //     Payload 的 getRequestTheme（cookie → 该请求头 → 默认 light）据此在服务端
  //     直接渲染正确主题，二次起访问首帧即正确色，不需要任何内联脚本
  //     （旧的内联主题脚本在 flight 流里客户端挂载、从不执行，2026-10-16 移除，
  //     详见 src/app/(payload)/layout.tsx 顶部注释）。仅一个色偏好的低敏提示，
  //     首次访问尚无 hint 时回落 Payload 原生行为（hydration 后按 matchMedia 改）。
  // 说明：暂不强上 CSP —— 后台（vditor/lexical/内联样式与脚本）内联内容多，贸然加会碎掉界面；
  //       建议后续单独做 CSP 基线并按 nonce 方案灰度验证后再启用。
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Accept-CH', value: 'Sec-CH-Prefers-Color-Scheme' },
      // 关掉浏览器用不到的强能力（摄像头/麦克风/定位/支付等），减少第三方脚本的可用面。
      // 音乐播放器走 <audio>，不受 Permissions-Policy 影响。
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    ]
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // 2026-10-18：线上实测 `/` 响应缺全部安全头，而 `/archive`、`/admin`、`/api/*` 都有
      // （本地 dev 的 `/` 也正常）。`/:path*` 匹配零段路径，理论上应覆盖 `/`，
      // 但 EdgeOne 上根路径走的是另一条处理路径，命不中。这里显式再声明一条，
      // 让根路径的响应也带上同一组头；两条规则对非根路径重复无害（值完全相同）。
      {
        source: '/',
        headers: securityHeaders,
      },
    ]
  },
  // 后台未登录时的 HTTP 307 跳转（不依赖 middleware）。
  //
  // 背景（2026-10-18 后台打不开事故）：`src/middleware.ts` 里那段「未登录 → 307 到
  // /admin/login」在 EdgeOne 上**根本没有执行**（实测连打 14 次登录接口无 429，
  // 说明限频也没跑；/admin 返回 200 且 body 里带 NEXT_REDIRECT）。而 Next 自带的
  // RSC 重定向在 EdgeOne 上会间歇 500 → 后台白屏，这正是当初加 middleware 的原因。
  //
  // 这里用 Next 的路由层 redirects 兜底：它由主应用（Node 函数）处理，不经过
  // edge middleware 那条链路，平台侧一定生效。判断依据是 Payload 的登录 cookie
  // `payload-token` 是否存在（middleware.ts 里的 COOKIE_NAME，改名需同步）。
  //   - 没有 cookie → 307 到 /admin/login（登录页本身不在规则内，无死循环）
  //   - 有 cookie（哪怕已过期）→ 放行，交给 Payload 自己校验签名
  async redirects() {
    // 只兜底主入口 `/admin`（用户实际访问的地址）。
    // 为什么不覆盖子路径：path-to-regexp 的自定义正则只匹配单段，写出既能跨段、
    // 又能排除 /admin/login 的 source 会解析失败（实测 build 直接报
    // "Invalid redirect found"）。而 /admin/login 必须放行，否则 307 死循环。
    // 未登录深链（/admin/collections/...）暂由 middleware 负责——平台恢复后自动生效；
    // 登录后的子页面导航都带 cookie，不受影响。
    return [
      {
        source: '/admin',
        missing: [{ type: 'cookie', key: 'payload-token' }],
        destination: '/admin/login',
        permanent: false,
      },
    ]
  },
  // 注意：不需要 rewrites，静态博客文件由 src/app/[[...path]]/route.ts 提供
}

export default withPayload(nextConfig)
