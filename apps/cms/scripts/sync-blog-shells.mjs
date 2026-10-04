#!/usr/bin/env node
// 本地刷新前台外壳：重建 Astro 产物，再把它复制进 apps/cms/public/（HTML 进 __blog/）。
//
// 为什么需要它：9527 前台的文章详情页读的是 public/__blog/ 里的静态外壳快照，
// 只有这里跑过一次，新建/改名的文章才能打开（列表页是运行时注入的，看起来永远正常，
// 所以「列表能看、详情 404」就是外壳过期的信号）。
//
// 为什么必须显式覆盖 PUBLIC_PAYLOAD_URL：`astro build` 是 mode=production，会自动加载
// apps/blog/.env.production，其中的 PUBLIC_PAYLOAD_URL 指向线上域名。本地拉不通时构建
// 不会报错，而是静默回退本地 markdown 兜底，产出一个「0 篇文章」的空站。
// Vite 让真实 process.env 优先于 .env 文件，所以这里直接注入即可。
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const BLOG = path.join(REPO, 'apps', 'blog');
const IS_WIN = process.platform === 'win32';

function run(label, cmd, args, opts) {
  console.log(`[sync-blog] ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: IS_WIN, cwd: REPO, ...opts });
  if (r.status !== 0) {
    if (r.error) console.error(`[sync-blog] 启动子进程失败: ${r.error.message}`);
    console.error(`[sync-blog] 失败（退出码 ${r.status ?? 'null'}，信号 ${r.signal ?? '无'}）：${label}`);
    process.exit(1);
  }
}

// 改 process.env 让子进程继承，而不是给 spawnSync 传整份 env：后者要自己带齐
// Windows 启动 cmd.exe 依赖的系统变量（SystemRoot/ComSpec），漏了子进程会静默起不来。
process.env.PUBLIC_PAYLOAD_URL = 'http://127.0.0.1:9527';
process.env.SITE_URL = 'http://localhost:9527';

run('重建前台产物（PUBLIC_PAYLOAD_URL / SITE_URL 指向本地后台）', 'npm', ['run', 'build'], { cwd: BLOG });

run('复制外壳到 apps/cms/public/', 'node', ['apps/cms/scripts/copy-blog-to-public.mjs']);

console.log('[sync-blog] 完成。本地外壳的 canonical/og 是 localhost:9527，上线请走 npm run build:all。');
