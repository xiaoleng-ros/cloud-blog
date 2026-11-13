# 0003 · 静态资源体积预算：图片进仓库前先过尺寸关

- **状态**：已采纳
- **日期**：2026-11-13
- **影响范围**：`apps/cms/public/cloud-icons/`、`apps/blog/public/images/`、`apps/cms/scripts/optimize-site-icons.mjs`

## 背景

2026-10-31 的首屏审计给出了一组刺眼的数字：首页首屏合计 ≈ 3.25 MB，
其中 **2.67 MB 来自两张本可以只有几十 KB 的图**：

| 资源                                         | 字节                   | 实际显示尺寸                                | 冗余倍数                            |
| -------------------------------------------- | ---------------------- | ------------------------------------------- | ----------------------------------- |
| `apps/cms/public/cloud-icons/cloud-dark.png` | 2,167,382（1536×1024） | 2.4rem × 2.4rem（后台 logo）+ 32×32 favicon | ≈ 48×                               |
| `apps/blog/public/images/footer-animals.png` | 378,766（1948×236）    | 页脚装饰条                                  | 已有 webp 版本 56,576 B，PNG 零引用 |

第一张图是在 `<head>` 里被引用的站点图标：它让**每一次首屏访问**都先下载 2.1 MB。

## 决策

1. **按最大实际显示尺寸定档，不按原图尺寸入库。**
   `cloud-dark.png` 最大用途是 2.4rem（≈38 px @1x，≈115 px @3x）与 180 px 的
   apple-touch-icon。512 宽已有 2.6 倍余量 → 压到 512×341。
2. **同一资源存在现代格式替代（webp/avif）时，旧格式必须删掉而不是留着。**
   `footer-animals.png` 与 `footer-animals.webp` 内容完全相同，PNG 无任何引用，
   留着只会让后来者误以为它是有效资源。
3. **保留 PNG 的场景**：favicon / apple-touch-icon 需要 PNG（部分平台不认 webp），
   所以 `optimize-site-icons.mjs` 在构建期仍从 PNG 源派生这两份。

## 实测结果

| 文件                 | 处理前                   | 处理后                        | 降幅   |
| -------------------- | ------------------------ | ----------------------------- | ------ |
| `cloud-dark.png`     | 2,167,382 B（1536×1024） | 37,222 B（512×341）           | −98.3% |
| `footer-animals.png` | 378,766 B                | 删除（保留 56,576 B 的 webp） | −100%  |

`cloud-dark.png` 的处理参数：`sharp().resize({ width: 512, withoutEnlargement: true })
.png({ compressionLevel: 9, adaptiveFiltering: true })`。

## 权衡过但未采用的方案

| 方案                                  | 体积     | 否决原因                                                         |
| ------------------------------------- | -------- | ---------------------------------------------------------------- |
| 512 宽 palette PNG（`palette: true`） | 10,047 B | 书法笔锋有细腻渐变，调色板量化会出现可见色带                     |
| 512 宽 WebP q90                       | 15,486 B | favicon / apple-touch-icon 需要 PNG，多一份格式反而多一处维护点  |
| 384 宽 PNG                            | 20,851 B | 已接近收益拐点，再小对 2.6 倍余量没有帮助，反而放大 @3x 下的模糊 |
| 256 宽 PNG                            | 10,598 B | 在 180 px 的 apple-touch-icon @2x 场景下已不足                   |

## 后果

- 首屏减少 2.5 MB 传输（在图片层，与 HTML 静态化正交）。
- `optimize-site-icons.mjs` 的 `optimizeFooterAnimals()` 曾因源 PNG 不存在而每次构建
  打印一行警告；现已改为**静默返回**，并在注释里说明「源 PNG 已移出仓库，
  这里只是兼容分支，webp 由 astro build 从 public 原样复制」。
- **可执行的判据**：新增图片进仓库前问一句「它的最大显示尺寸是多少像素」，
  位图宽度超过该值 3 倍就是在浪费。矢量图标优先 SVG。
