# 第三方来源与许可声明

本项目（`cloud-blog` · 云岫的博客）整体以 **GPL-3.0** 发布（见 [LICENSE](LICENSE)）。以下列出其中来自第三方开源项目的部分及其原始许可。

---

## 1. clay-blog — 前台基底（MIT）

- 来源：<https://github.com/laogou717/clay-blog>
- 用途：`apps/blog`（Astro 博客前端）的初始骨架、组件与样式源自该项目，本项目在其之上做了大幅重构（内容改为全部来自 Payload CMS、加入实时同步、重做页面与样式等）。
- 许可：MIT（宽松许可，可与 GPL-3.0 共存；其原始条款随本文件一并保留，见下方全文）。

```
MIT License

Copyright (c) 2026 laogou717

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. ThriveX-Blog — 版式参考 + 素材（GPL-3.0）

- 来源：<https://github.com/LiuYuYang01/ThriveX-Blog>
- 用途：
  1. **版式与交互参考**（未复制其源代码）：后台的卡片式外壳、两级缩进导航、标签页记忆、数据概览页，以及前台的若干页面布局，均参考该项目的视觉与交互设计后自行实现；
  2. **静态素材**：`apps/blog/public/images/footer-animals.png`（页脚动物插画）为该仓库 `src/components/Footer/images/animals.webp` 的同一文件。
- 许可：**GPL-3.0**。因第 2 项素材随本项目一起分发，本项目整体按 GPL-3.0 发布（这正是本仓库选择 GPL-3.0 而非 MIT 的原因）。

---

## 3. 其余第三方依赖

`apps/blog`、`apps/cms` 的 `package.json` / lockfile 中列出的依赖（Astro、Payload CMS、Next.js、React、Waline、patch-package 等）各自遵循其原始许可，均未修改其许可条款。
