/**
 * 后台预热脚本：后台 dev server 冷启动时，首次访问 /admin 与 /api 需要长时间编译
 * （约 20~40s），期间前端请求会超时并出现 "TypeError: network error"。
 * 运行本脚本提前触发编译，之后访问后台与前台数据加载都会很快。
 *
 * 用法（后台 dev 启动后执行一次）：
 *   npm run warmup
 * 或直接用一键命令（起 PG + dev + 自动跑到本脚本）：
 *   npm run dev:warm
 *
 * Turbopack 的 dev 编译是按「实际 URL」建条目的，所以只热 /admin 一条，
 * 点侧栏里的文章管理/分类页/站点设置仍然各付一次十几秒的编译费。
 * 因此这里把侧栏全部入口都列进 targets（改 nav-config.ts 时同步改这里）。
 *
 * 注意：未登录时 middleware 会先 307 到 /admin/login，目标页根本不渲染、也就不会编译。
 * 要真正预热后台各页，把浏览器里 payload-token cookie 的值传进来：
 *   WARM_COOKIE=<payload-token 值> npm run warmup
 */
const BASE = process.env.PUBLIC_PAYLOAD_URL?.replace(/localhost/gi, '127.0.0.1') ?? 'http://127.0.0.1:9527';

/** 侧栏各入口（与 src/admin/shell/nav-config.ts 一一对应） */
const ADMIN_PATHS = [
  '/admin',
  '/admin/write-post',
  '/admin/write-note',
  '/admin/drafts',
  '/admin/trash',
  '/admin/collections/posts',
  '/admin/collections/notes',
  '/admin/collections/categories',
  '/admin/collections/tags',
  '/admin/collections/media',
  '/admin/globals/navigation',
  '/admin/globals/site-settings',
  '/admin/account',
];

/**
 * 后台进任意一页都会并发打的那几个 REST 端点。
 * 同样按 URL 编译，实测冷启动代价：/api/media 13.1s、/api/blog-sync 10.4s、
 * /api/users/me 与 /api/categories /api/tags 各 0.1~0.25s（首次落在导航后的空窗里）。
 * 少热一条，点完侧栏就要原地等它编译。
 */
const API_PATHS = [
  '/api/users/me',
  '/api/media?limit=1',
  '/api/categories?limit=1',
  '/api/tags?limit=1',
  '/api/posts?limit=1',
  '/api/notes?limit=1',
  '/api/projects?limit=1',
  '/api/globals/site-settings',
  '/api/globals/navigation',
  '/api/blog-sync?digest=1',
];

/**
 * 9527 上被 CMS 直接服务的前台静态页（列表页是运行时注入的，首次访问要付费）。
 * 用户从 9527 浏览前台时，这些是高频入口；冷渲染实测单页 0.3~1.5s（编译另计）。
 */
const BLOG_PATHS = ['/', '/stats', '/notes', '/about', '/tags', '/search', '/archive'];

/**
 * 评论区（Waline 进程内接管）首屏接口。
 * 评论组件滚入视口才发第一个请求，真人滚动评论区 = 这条路由的首次编译+Waline 初始化，
 * 实测 2026-10-10 冷了 3.5 分钟，期间整个 dev server 不再服务其他路由，
 * 前台所有页面导航跟着打 20s 超时（页面渲染要同步等 CMS 设置接口）。
 * 放最后预热（不被它堵住其他项），超时放宽到 300s：这笔编译就是要一次性付清的最大一笔。
 * 路由是单文件全捕获（app/api/waline/[[...path]]/route.ts），打任意一条即编译整块。
 */
const WALINE_PATHS = [
  '/api/waline/api/comment?path=%2F&pageSize=10&page=1&lang=zh-CN&sortBy=insertedAt_desc',
  '/api/waline/api/article?path=%2F&type=reaction0&lang=zh-CN',
];

const targets = [
  ...ADMIN_PATHS.map((path) => [path, 120]),
  ...API_PATHS.map((path) => [path, 60]),
  ...BLOG_PATHS.map((path) => [path, 60]),
  ...WALINE_PATHS.map((path) => [path, 300]),
];

/**
 * 文章详情页 URL 是动态的（/posts/{分类}/{ID}），从 API 里挑一篇已发布的补进预热清单。
 * 失败不致命：详情页首次访问时现编译即可。
 */
async function addArticleTarget() {
  try {
    const res = await fetch(`${BASE}/api/posts?limit=1&depth=1`);
    if (!res.ok) return;
    const data = await res.json();
    const doc = data?.docs?.[0];
    if (!doc || doc.status !== 'published') return;
    const cat = doc.categories && typeof doc.categories === 'object' ? doc.categories.name : '';
    const path = cat
      ? `/posts/${encodeURIComponent(cat)}/${doc.id}`
      : `/posts/${doc.id}`;
    targets.splice(targets.length - BLOG_PATHS.length, 0, [path, 60]);
  } catch {
    // 忽略：预热失败不影响使用
  }
}

const tm = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cookie = process.env.WARM_COOKIE;
  if (!cookie) {
    console.log('ℹ️  未设 WARM_COOKIE：/admin/* 会被 middleware 307 到登录页，只热 /api 与登录页。\n');
  }
  await addArticleTarget();
  for (const [path, timeout] of targets) {
    const url = `${BASE}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout * 1000);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: cookie ? { cookie: `payload-token=${cookie}` } : undefined,
      });
      const note = res.status === 307 ? '（未登录，跳过编译）' : '';
      console.log(`✅ ${path}  HTTP ${res.status}  (${Date.now() - start}ms)${note}`);
    } catch (err) {
      console.log(`⚠️  ${path}  预热失败（${err.message}），继续下一项`);
    } finally {
      clearTimeout(t);
    }
    // 触发编译后稍微让出，避免瞬时高并发
    await tm(800);
  }
  console.log('\n🎉 预热完成，后台已就绪');
  process.exit(0);
}

main();