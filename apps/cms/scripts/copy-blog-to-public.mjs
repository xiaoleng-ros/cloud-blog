// 把 Astro 构建产物（apps/blog/dist/）复制到 CMS 的 public/ 目录。
// EdgeOne Makers 部署 Next.js 时，会把 public/ 下的文件作为静态资源直接服务，
// 这样博客页面（/、/posts/* 等）与 Payload 后台（/admin/*、/api/*）共存于同一域名。
//
// 复制策略（修复「双份真相」后）：
//   1. 非 HTML 产物（CSS/JS/图片/feed 等）按原样复制到 public/ 根 —— 静态资源
//      由静态托管直接命中，路由侧 src/app/[[...path]]/route.ts 也以此为兜底读取。
//   2. HTML 只复制一份到 public/__blog/<同样的相对路径> —— 供运行时路由读取
//      「外壳」并在响应时注入后台最新数据。
//
// 为什么根目录不再放 HTML：route.ts 的 HTML 分支完全从 public/__blog/ 读取
// （getStaticHtmlPath 只查 __blog；静态资源分支显式跳过 .html；404 页也从 __blog 读），
// 注入路径已完整覆盖全部页面。而根目录的 HTML 副本会被静态托管直接命中、绕过注入，
// 永远返回构建时的旧内容（「首屏先闪旧文案」的根因），属于纯危害，不再产出。
//
// 清理策略：脚本只删「自己复制出去的文件」。每轮把复制到 public/ 根的文件清单
// 写入 public/.copy-blog-manifest.json；下一轮先按旧清单删除已不在本轮产物中的
// 陈旧文件（例如后台删掉文章后遗留的幽灵资源），再复制。不再递归删 public/ 下
// 全部 .html —— 那会波及非本脚本产物的文件。首次运行（无清单）时做一次迁移：
// 根目录的 .html 全部是旧版本脚本复制的 Astro 产物（.gitignore 已声明 public/
// 内容均为构建产物），此时按旧约定清除，之后一律走清单。
// 触发方式：npm run build:all 最后手动执行（必须在 next build 之后，避免被覆盖）。
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
// apps/cms/public/ —— Next.js 约定的静态资源目录，EdgeOne 会自动部署
const CMS_PUBLIC = join(import.meta.dirname, '../public');
// HTML 外壳目录名（route.ts 运行时按此名探测；HTML_ROOT = public/<HTML_DIR_NAME>）
const HTML_DIR_NAME = '__blog';
// HTML 外壳目录（唯一一份 HTML，供运行时注入使用）
const HTML_ROOT = join(CMS_PUBLIC, HTML_DIR_NAME);
// 本脚本复制产物清单（相对 public/ 的路径列表），用于「只清自己复制的文件」
const MANIFEST_FILE = join(CMS_PUBLIC, '.copy-blog-manifest.json');

// 不参与清理的目录（后台媒体上传、图标等非构建产物）
const KEEP_DIRS = new Set(['media', 'cloud-icons']);

// 这些产物不复制到 public/ 根：CMS 已有同路径的动态路由（Next 检测到
// 「公共文件与路由冲突」会直接 500），由路由按请求实时生成、保证与后台数据同步。
const SKIP_ROOT_FILES = new Set(['site-index.json']);

if (!existsSync(BLOG_DIST)) {
  console.error('[copy-blog] 找不到 Astro 构建产物，跳过复制: ' + BLOG_DIST);
  process.exit(0);
}

/** 读取上一轮清单；不存在或损坏时返回 null（触发一次性迁移清理） */
function readPreviousManifest() {
  if (!existsSync(MANIFEST_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));
    return Array.isArray(parsed?.root) ? parsed.root.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * 一次性迁移清理（仅首次没有清单时执行）：
 * 旧版脚本把 HTML 复制到 public/ 根，这些副本会绕过运行时注入返回旧内容，
 * 且后台删文章后残留「幽灵页面」。按旧约定清除根目录 .html（media/、cloud-icons/、
 * __blog/ 除外）；此后各轮一律按清单精确清理，不再做递归删除。
 */
function removeLegacyRootHtml() {
  let removed = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (current === CMS_PUBLIC && (KEEP_DIRS.has(entry.name) || entry.name === '__blog')) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        rmSync(full, { force: true });
        removed += 1;
      }
    }
  };
  walk(CMS_PUBLIC);
  return removed;
}

/** 按上一轮清单删除本轮已不存在的陈旧文件（只删本脚本自己复制出去的文件） */
function removeStaleFromManifest(prevEntries, currentSet) {
  let removed = 0;
  for (const entry of prevEntries) {
    if (currentSet.has(entry)) continue;
    const full = join(CMS_PUBLIC, ...entry.split('/'));
    if (existsSync(full)) {
      rmSync(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/**
 * 将 dist/ 内容递归复制：
 *   - HTML → 只写 public/__blog/（运行时注入的外壳，根目录不再放副本）
 *   - 其它文件 → 只写 public/ 根，并登记进 copiedRoot 清单
 */
function copyDir(src, destDir, destHtmlDir, copiedRoot) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcPath = join(src, entry.name);
    const relRoot = relative(CMS_PUBLIC, join(destDir, entry.name)).split('\\').join('/');
    if (entry.isDirectory()) {
      copyDir(srcPath, join(destDir, entry.name), join(destHtmlDir, entry.name), copiedRoot);
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.html')) {
      const shellTarget = join(destHtmlDir, entry.name);
      mkdirSync(dirname(shellTarget), { recursive: true });
      copyFileSync(srcPath, shellTarget);
      continue;
    }
    if (SKIP_ROOT_FILES.has(entry.name)) continue;
    const rootTarget = join(destDir, entry.name);
    mkdirSync(dirname(rootTarget), { recursive: true });
    copyFileSync(srcPath, rootTarget);
    copiedRoot.push(relRoot);
  }
}

// __blog 下只会放 HTML，整体重建最干净
rmSync(HTML_ROOT, { recursive: true, force: true });
mkdirSync(HTML_ROOT, { recursive: true });
mkdirSync(CMS_PUBLIC, { recursive: true });

const prevManifest = readPreviousManifest();
if (prevManifest === null) {
  const legacy = removeLegacyRootHtml();
  if (legacy > 0) {
    console.log(`[copy-blog] 首次迁移：清除旧版脚本复制到根目录的 HTML ${legacy} 个（此后按清单清理）`);
  }
}

/** 本轮复制到 public/ 根的文件（相对路径） */
const copiedRoot = [];
copyDir(BLOG_DIST, CMS_PUBLIC, HTML_ROOT, copiedRoot);

const currentSet = new Set(copiedRoot);
if (prevManifest !== null) {
  const removed = removeStaleFromManifest(prevManifest, currentSet);
  if (removed > 0) {
    console.log(`[copy-blog] 按清单清理上一轮遗留文件 ${removed} 个`);
  }
}

writeFileSync(MANIFEST_FILE, JSON.stringify({ version: 1, root: copiedRoot }, null, 2));
console.log('[copy-blog] 已复制：静态资源 → public/ 根，HTML 仅一份 → public/__blog/（供运行时注入）');

// ─── 把外壳同步进 .next/standalone —— 修「全站 404 · Not Found」 ────────────
//
// 时序坑（2026-10-12 实际翻车）：`next build` 生成 standalone 时，会把**当时**的
// public/ 整个快照进 .next/standalone/<app>/public；而本脚本在 build 之后才把 Astro
// 产物（__blog 外壳）写进 public —— 于是：
//   · CDN 静态层拿到的是最终 public（/__blog/index.html 能 200，一切正常）；
//   · 云函数包只拷 standalone 快照，容器里没有 public/__blog → route.ts 读不到外壳，
//     全站每个页面（含 /favicon.ico）都落到兜底分支回纯文本 404「Not Found」。
// 修复：写完 public 后，把外壳补进 standalone 快照。
//
// 目标子目录与 @edgeone/opennextjs-pages 的 PluginContext 同口径：
//   distDir       = relative(cwd, resolve(relativeAppDir, config.distDir))  // apps/cms/.next
//   函数包拷贝     .next/standalone/<distDir 的父目录>/*，容器内 cwd 也是这个父目录
// 同步两处（2026-10-12 二次实锤：插件打包**不含 public/**——静态层有外壳、函数容器
// 里没有，route.ts 全部候选落空 → 全站纯文本 404）：
//   1. standalone/<app>/public/__blog  —— 静态层/兜底用，插件若含 public 则生效
//   2. standalone/<app>/.next/__blog   —— 函数包必含 .next（服务端运行必需），此份
//      一定能进容器；route.ts 的 resolveHtmlDir 已加对应候选
// 额外再放一份到 standalone 根：口径万一不同（cwd 在函数包根）也能被路由的
// 向上探测（walkUpFor）命中；该副本是否进包取决于插件版本，体积按下面日志核对。
function syncShellsToStandalone() {
  const reqFilesPath = join(import.meta.dirname, '..', '.next', 'required-server-files.json');
  const standaloneRoot = join(import.meta.dirname, '..', '.next', 'standalone');
  if (!existsSync(reqFilesPath) || !existsSync(standaloneRoot)) {
    console.log('[copy-blog] 未找到 .next/standalone（非 standalone 构建？），跳过外壳同步');
    return;
  }
  let targets;
  try {
    const rsf = JSON.parse(readFileSync(reqFilesPath, 'utf-8'));
    const distDir = relative(process.cwd(), resolve(rsf.relativeAppDir || '', rsf.config?.distDir || '.next'));
    const appDir = dirname(distDir);
    targets = [
      join(standaloneRoot, appDir, 'public', HTML_DIR_NAME),
      join(standaloneRoot, appDir, '.next', HTML_DIR_NAME),
    ];
    const rootTarget = join(standaloneRoot, 'public', HTML_DIR_NAME);
    if (!targets.includes(rootTarget)) targets.push(rootTarget);
  } catch (err) {
    console.warn('[copy-blog] 解析 required-server-files.json 失败，跳过外壳同步:', err.message);
    return;
  }
  for (const target of targets) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(HTML_ROOT, target, { recursive: true });
    console.log('[copy-blog] 已同步外壳 → ' + relative(import.meta.dirname, target));
  }
}
syncShellsToStandalone();
