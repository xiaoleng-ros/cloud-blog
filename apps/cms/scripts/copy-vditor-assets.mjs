// 把 Vditor 的运行时静态资源从 node_modules 复制到 CMS 的 public/vditor/dist，
// 让编辑器不再依赖 unpkg 等境外 CDN。
//
// 为什么必须自托管：
//   vditor/dist/index.js 里写死 `Constants.CDN = "https://unpkg.com/vditor@4.0.1"`，
//   初始化时要用 addScript 拉 lute（Markdown 引擎）、i18n、图标三组脚本，
//   预览里的代码高亮 / 数学公式 / 图表也都是运行期按需从 CDN 拉。
//   而 addScript 的 .then() 全都没接 .catch()：网络被拦时不报错、只是静默不初始化，
//   表现为「编辑器空白 / 预览不动 / 插入图片没反应」，控制台连错误都没有。
//   境内访问 unpkg 经常被重置，实测用户侧连 gravatar 都是 ERR_CONNECTION_CLOSED。
//
// 为什么目录是 public/vditor/dist：
//   Vditor 内部所有路径都是 `cdn + "/dist/..."`，把 cdn 设为 '/vditor' 后，
//   请求落在 /vditor/dist/...，因此必须保留 dist 这一层。
//
// 为什么不复制整个 dist：
//   dist 全量 21.92MB。这里复制 js / css / images 三个子树（跳过 mathjax 6.33MB，
//   它只在显式选用 MathJax 渲染数学时才加载，本项目走默认的 KaTeX），外加根目录的
//   index.css 与 method.min.js（导出 HTML 用）。不复制的是 index.js / index.min.js /
//   method.js（editor 本体由 Next 打包，不需要）与 ts / *.d.ts 类型声明。
//   代码高亮、KaTeX、mermaid 等重型脚本只在正文出现对应语法时才被 addScript 拉取，
//   因此保留它们只增加部署体积，不增加页面首屏开销。
//
// 触发方式：apps/cms/package.json 的 predev / prebuild，npm 自动在 dev / build 前执行。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// vditor 装在本包自己的 node_modules 下；若被提升到仓库根则退回根目录找。
const LOCAL_VEDITOR_DIST = join(import.meta.dirname, '../node_modules/vditor/dist');
const HOISTED_VEDITOR_DIST = join(import.meta.dirname, '../../../node_modules/vditor/dist');
const VEDITOR_DIST = existsSync(LOCAL_VEDITOR_DIST) ? LOCAL_VEDITOR_DIST : HOISTED_VEDITOR_DIST;

const TARGET_ROOT = join(import.meta.dirname, '../public/vditor');
const TARGET_DIST = join(TARGET_ROOT, 'dist');

// 只复制这三个子树（其余是打包产物、TS 声明，或 mathjax 这个 6.33MB 的备用引擎）
const COPY_SUBTREES = ['js', 'css', 'images'];
// js 下面再跳过 mathjax（与 KaTeX 功能重叠且体积最大）
const SKIP_JS_DIRS = new Set(['mathjax']);

// dist 根目录下这两个文件不被编辑器本体使用，只有「导出 HTML」「打印预览」两条路径
// 会以 cdn + "/dist/xxx" 的形式引用（见 vditor/dist/index.js:13369、13377）。
// 体积极小（共约 100KB），顺手带上，避免导出功能静默缺样式。
const COPY_ROOT_FILES = ['index.css', 'method.min.js'];

if (!existsSync(VEDITOR_DIST)) {
  // 依赖没装（例如只装了 blog 侧）时不阻断构建：cdn 会退回默认值，
  // 编辑器仍可用，只是又会依赖外网 CDN。
  console.warn('[vditor-assets] 找不到 node_modules/vditor/dist，跳过复制: ' + VEDITOR_DIST);
  process.exit(0);
}

/** 递归复制，skipDirs 只作用于当前这一层的直接子目录 */
function copyDir(src, dest, skipDirs) {
  mkdirSync(dest, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDir(from, to, new Set());
      files += sub.files;
      bytes += sub.bytes;
      continue;
    }
    cpSync(from, to);
    files += 1;
    bytes += statSync(to).size;
  }
  return { files, bytes };
}

rmSync(TARGET_DIST, { recursive: true, force: true });
mkdirSync(TARGET_DIST, { recursive: true });

let totalFiles = 0;
let totalBytes = 0;
for (const sub of COPY_SUBTREES) {
  const from = join(VEDITOR_DIST, sub);
  if (!existsSync(from)) continue;
  const skip = sub === 'js' ? SKIP_JS_DIRS : new Set();
  const { files, bytes } = copyDir(from, join(TARGET_DIST, sub), skip);
  totalFiles += files;
  totalBytes += bytes;
}

for (const file of COPY_ROOT_FILES) {
  const from = join(VEDITOR_DIST, file);
  if (!existsSync(from)) continue;
  cpSync(from, join(TARGET_DIST, file));
  totalFiles += 1;
  totalBytes += statSync(join(TARGET_DIST, file)).size;
}

console.log(
  `[vditor-assets] 已复制 ${totalFiles} 个文件（${(totalBytes / 1024 / 1024).toFixed(2)}MB）到 public/vditor/dist`,
);

// 写一个可被 HTTP 直接读到的版本标记（GET /vditor/version.json）。
// 用途：线上排查时判断「自托管资源到底有没有进这次部署」——
// 返回 200 且 assets 数与本地一致，说明 prebuild 跑了、文件也 serve 出来了；
// 返回 404 说明 public/vditor 没被带上（构建时 vditor 缺失，脚本走了跳过分支）。
// 只写版本号与文件数，不写时间戳：内容稳定才能拿来比对，否则每次构建都变。
// 文件名不带前导点：静态托管层经常跳过 dotfile，那样这个探针就永远 404、失去意义。
writeFileSync(
  join(TARGET_ROOT, 'version.json'),
  JSON.stringify({ vditor: '4.0.1', assets: totalFiles, bytes: totalBytes }, null, 2) + '\n',
);
