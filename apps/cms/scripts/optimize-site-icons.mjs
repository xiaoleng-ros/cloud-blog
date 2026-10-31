// 站点图标瘦身（P0-1）：构建期用 sharp 把博客 public/ 里的大图标生成为小尺寸变体，
// 供 <link rel="icon"> / <link rel="apple-touch-icon"> / 页脚头像直接引用。
//
// 背景：settings.siteIcon 通常是 Supabase 上的原始大图（实测 1306×1205 / 2.38MB PNG），
// 被 <head> 引用两次 + 页脚头像（显示 40×40）一次，首屏要多下 2MB+。
// 现在构建期本地生成三个小文件（放 apps/blog/dist/avatars/，随 copy-blog-to-public
// 一起进静态层，享受 immutable + br）：
//   favicon-32.png      32×32   PNG   → <link rel="icon">（兼容性最好）
//   apple-touch-icon.png 180×180 PNG  → <link rel="apple-touch-icon">（苹果要求 PNG）
//   avatar-80.webp       80×80   WebP  → 页脚头像（显示 40×40，2x 高清屏）
//
// 另外顺带做装饰图（P0-4）：apps/blog/public/images/footer-animals.png
//   1948×236 / 379KB PNG → 同尺寸 WebP q82（实测约 60KB，−84%）
//
// 输入源优先级：
//   1) apps/blog/public/avatars/avatar.png（仓库内默认图标）
//   2) settings.siteIcon 指向的 Supabase 远程图（SITE_ICON_URL 环境变量注入，
//      避免在构建脚本里连数据库）
// 二者都没有时跳过（保留现有引用，不破坏构建）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_PUBLIC = join(import.meta.dirname, '../../blog/public');
const BLOG_DIST = join(import.meta.dirname, '../../blog/dist');
const SOURCE = join(BLOG_PUBLIC, 'avatars/avatar.png');

async function main() {
  let inputBuf;
  let sourceDesc;
  if (existsSync(SOURCE)) {
    inputBuf = readFileSync(SOURCE);
    sourceDesc = 'public/avatars/avatar.png';
  } else if (process.env.SITE_ICON_URL) {
    sourceDesc = process.env.SITE_ICON_URL;
    process.stderr.write(`[optimize-icons] 尝试从 ${sourceDesc} 拉取站点图标…\n`);
    const res = await fetch(process.env.SITE_ICON_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`拉取站点图标失败：HTTP ${res.status}`);
    inputBuf = Buffer.from(await res.arrayBuffer());
  } else {
    process.stderr.write('[optimize-icons] 未找到图标源（public/avatars/avatar.png 或 SITE_ICON_URL），跳过\n');
    return;
  }

  const sharp = (await import('sharp')).default;
  const image = sharp(inputBuf, { failOn: 'none' });
  const meta = await image.metadata();

  const targets = [
    { file: 'favicon-32.png', size: 32, format: 'png' },
    { file: 'apple-touch-icon.png', size: 180, format: 'png' },
    { file: 'avatar-80.webp', size: 80, format: 'webp' },
  ];

  const outDir = join(BLOG_DIST, 'avatars');
  mkdirSync(outDir, { recursive: true });

  for (const { file, size, format } of targets) {
    const buf = await sharp(inputBuf, { failOn: 'none' })
      .resize(size, size, { fit: 'cover', withoutEnlargement: true })
      [format](format === 'webp' ? { quality: 82 } : { compressionLevel: 9, palette: true })
      .toBuffer();
    writeFileSync(join(outDir, file), buf);
    process.stdout.write(`[optimize-icons] ${file} ← ${sourceDesc} (${meta.width}×${meta.height}) → ${buf.length}B\n`);
  }

  await optimizeFooterAnimals(sharp);
}

/**
 * 页脚装饰条（P0-4）：1948×236 PNG 379KB 纯装饰图 → 同尺寸 WebP。
 * 尺寸不变（CSS 按 width:100% 铺满虚线），只换编码。
 */
async function optimizeFooterAnimals(sharp) {
  const src = join(BLOG_PUBLIC, 'images/footer-animals.png');
  if (!existsSync(src)) {
    process.stderr.write('[optimize-icons] 未找到 footer-animals.png，跳过装饰图\n');
    return;
  }
  const outDir = join(BLOG_DIST, 'images');
  mkdirSync(outDir, { recursive: true });
  const buf = await sharp(src, { failOn: 'none' }).webp({ quality: 82 }).toBuffer();
  writeFileSync(join(outDir, 'footer-animals.webp'), buf);
  process.stdout.write(
    `[optimize-icons] footer-animals.webp ← public/images/footer-animals.png → ${buf.length}B\n`,
  );
}

main().catch((err) => {
  // 图标优化失败不阻塞构建：线上退化为现有引用（大图），下次构建再修
  process.stderr.write(`[optimize-icons] 失败（不阻塞构建）：${err?.message ?? err}\n`);
});
