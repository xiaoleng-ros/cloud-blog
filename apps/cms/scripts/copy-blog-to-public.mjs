// 把 Astro 构建产物（apps/blog/dist/）复制到 CMS 的 public/ 目录。
// EdgeOne Makers 部署 Next.js 时，会把 public/ 下的文件作为静态资源直接服务，
// 这样博客页面（/、/posts/* 等）与 Payload 后台（/admin/*、/api/*）共存于同一域名。
//
// 复制策略（两份 HTML，暂时是故意的）：
//   1. 全部产物按原样复制到 public/ 根 —— 与历史行为一致，静态托管能直接命中
//      /、/about、/posts/x 等路径，站点必然可用（保底）。
//   2. HTML 额外再复制一份到 public/__blog/<同样的相对路径> —— 供
//      src/app/[[...path]]/route.ts 读取「外壳」，在响应时注入后台最新数据。
//
// 为什么需要第 2 份：public/index.html 会被静态托管直接命中、绕过 Next 路由，
// 于是永远返回构建时的旧内容（这就是「首屏先闪旧文案」的根因）。
// 等确认路由侧能稳定读到 public/__blog/ 之后，把第 1 份里的 .html 去掉即可切换为
// 「响应时注入」；在那之前两份并存，优先保证站点不 404。
// 触发方式：npm run build:all 最后手动执行（必须在 next build 之后，避免被覆盖）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
// apps/cms/public/ —— Next.js 约定的静态资源目录，EdgeOne 会自动部署
const CMS_PUBLIC = join(import.meta.dirname, '../public');
// HTML 外壳目录（第二份，供运行时注入使用）
const HTML_ROOT = join(CMS_PUBLIC, '__blog');

// 不参与清理的目录（后台媒体上传、图标等非构建产物）
const KEEP_DIRS = new Set(['media', 'cloud-icons']);

if (!existsSync(BLOG_DIST)) {
  console.error('[copy-blog] 找不到 Astro 构建产物，跳过复制: ' + BLOG_DIST);
  process.exit(0);
}

/**
 * 清理上一轮构建留下的 HTML。
 * public/ 下的 .html 全部由 Astro 构建生成（.gitignore 已声明），
 * 上一轮的文章页在后台删掉文章后会变成「幽灵页面」，必须清掉；
 * media/ 与 cloud-icons/ 属于非构建产物，跳过。
 */
function removeStaleHtml(dir) {
  let removed = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (current === CMS_PUBLIC && KEEP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        rmSync(full, { force: true });
        removed += 1;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return removed;
}

/** 将 dist/ 内容递归复制到 public/ 根；HTML 额外再写一份到 HTML_ROOT */
function copyDir(src, destDir, destHtmlDir) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcPath = join(src, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, join(destDir, entry.name), join(destHtmlDir, entry.name));
      continue;
    }
    const rootTarget = join(destDir, entry.name);
    mkdirSync(dirname(rootTarget), { recursive: true });
    copyFileSync(srcPath, rootTarget);

    if (entry.name.toLowerCase().endsWith('.html')) {
      const shellTarget = join(destHtmlDir, entry.name);
      mkdirSync(dirname(shellTarget), { recursive: true });
      copyFileSync(srcPath, shellTarget);
    }
  }
}

const removed = removeStaleHtml(CMS_PUBLIC);
if (removed > 0) {
  console.log(`[copy-blog] 清理上一轮构建的 HTML 文件 ${removed} 个`);
}

mkdirSync(CMS_PUBLIC, { recursive: true });
// __blog 下只会放 HTML，整体重建最干净
rmSync(HTML_ROOT, { recursive: true, force: true });
mkdirSync(HTML_ROOT, { recursive: true });

copyDir(BLOG_DIST, CMS_PUBLIC, HTML_ROOT);
console.log('[copy-blog] 已复制到 apps/cms/public/（HTML 同时产出 public/ 根与 public/__blog/ 两份）');
