// 把 Astro 构建产物（apps/blog/dist/）复制到 CMS standalone 部署目录的 public/ 子目录。
// 触发方式：npm run build:all 最后手动执行（postbuild 钩子已在 blog/package.json 中移除，
// 因为 postbuild 在 Next.js 构建之前执行，会被 Next.js 重建覆盖）。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
// standalone/cloud/apps/cms/public/ —— EdgeOne Makers 部署时 Next.js server 从这里服务静态文件
const STANDALONE_PUBLIC = join(import.meta.dirname, '../.next/standalone/cloud/apps/cms/public');

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

mkdirSync(STANDALONE_PUBLIC, { recursive: true });
copyDir(BLOG_DIST, STANDALONE_PUBLIC);
console.log('[copy-blog] 已复制到 .next/standalone/public/（EdgeOne Makers 部署）');
