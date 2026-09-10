// 把 Astro 构建产物（apps/blog/dist/）复制到 Next.js public/ 根目录，
// 让 EdgeOne 直接把静态博客页面作为静态文件来服务（路径与开发时一致）。
//
// 触发方式：npm run build（Astro）完成后自动执行 postbuild 钩子。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
const CMS_PUBLIC = join(import.meta.dirname, '../public');

if (!existsSync(BLOG_DIST)) {
  console.error('[copy-blog] 找不到 Astro 构建产物，跳过复制: ' + BLOG_DIST);
  process.exit(0);
}

// 将 dist/ 内容递归复制到 public/（覆盖旧文件）
function copyDir(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      // 跳过 node_modules 等敏感目录
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(BLOG_DIST, CMS_PUBLIC);
console.log('[copy-blog] 完成：已复制 Astro 构建产物到 public/（根目录）');
