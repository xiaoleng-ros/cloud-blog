/**
 * 后台预热脚本：后台 dev server 冷启动时，首次访问 /admin 与 /api 需要长时间编译
 * （约 20~40s），期间前端请求会超时并出现 "TypeError: network error"。
 * 运行本脚本提前触发编译，之后访问后台与前台数据加载都会很快。
 *
 * 用法（后台 dev 启动后执行一次）：
 *   npm run warmup
 */
const BASE = process.env.PUBLIC_PAYLOAD_URL?.replace(/localhost/gi, '127.0.0.1') ?? 'http://127.0.0.1:9527';

const targets = [
  ['/admin', 120],
  ['/api/posts?limit=1', 60],
  ['/api/notes?limit=1', 60],
  ['/api/globals/site-settings', 60],
  ['/api/globals/navigation', 60],
];

const tm = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const [path, timeout] of targets) {
    const url = `${BASE}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout * 1000);
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      console.log(`✅ ${path}  HTTP ${res.status}  (${Date.now() - start}ms)`);
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