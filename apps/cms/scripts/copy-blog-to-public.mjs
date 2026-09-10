// 把 Astro 构建产物（apps/blog/dist/）复制到 CMS 的 public/ 目录。
// EdgeOne Makers 部署 Next.js 时，会把 public/ 下的文件作为静态资源直接服务，
// 这样博客页面（/、/posts/* 等）与 Payload 后台（/admin/*、/api/*）共存于同一域名。
// 触发方式：npm run build:all 最后手动执行（必须在 next build 之后，避免被覆盖）。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
// apps/cms/public/ —— Next.js 约定的静态资源目录，EdgeOne 会自动部署
const CMS_PUBLIC = join(import.meta.dirname, '../public');

if (!existsSync(BLOG_DIST)) {
  console.error('[copy-blog] 找不到 Astro 构建产物，跳过复制: ' + BLOG_DIST);
  process.exit(0);
}

// 将 dist/ 内容递归复制到目标目录（覆盖旧文件）
function copyDir(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      copyFileSync(srcPath, destPath);
    }
  }
}

mkdirSync(CMS_PUBLIC, { recursive: true });
copyDir(BLOG_DIST, CMS_PUBLIC);
console.log('[copy-blog] 已复制到 apps/cms/public/（EdgeOne Makers 部署）');
