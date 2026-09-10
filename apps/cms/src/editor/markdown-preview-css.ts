// 由 scripts/generate-preview-css.mjs 生成，勿手改。
export const markdownPreviewCss = `
.markdown-preview {
  color-scheme: light;
  --bg: #fbf7ed;
  --bg-tint: #f5f0e3;
  --surface: #fffefb;
  --surface-muted: #f7f2e4;
  --text: #3a3226;
  --text-muted: #6e6350;
  --text-faint: #998d78;
  --border: #d9ccb0;
  --border-strong: #bfae86;
  --accent: #3a3226;
  --accent-strong: #211b12;
  --accent-soft: #f1e7cf;
  --accent-line: rgba(58, 50, 38, 0.3);
  /* 参考图中「林一」名字高亮为粉色，品牌强调色同步偏粉 */
  --brand: #e85a7a;
  --brand-soft: rgba(232, 90, 122, 0.13);
  /* 手账便利贴色块（黄 / 青 / 粉 / 绿） */
  --sticky-yellow: #ffdf8a;
  --sticky-cyan: #7ddbd3;
  --sticky-pink: #ffb7c9;
  --sticky-green: #c9e6a4;
  --sticky-purple: #d8c4f7;
  /* 荧光笔高亮色 */
  --marker-yellow: #fff176;
  --marker-cyan: #a7ffeb;
  --marker-pink: #ff80ab;
  /* 手绘线条 / 内页格线 */
  --ink: #3a3226;
  --paper-line: rgba(154, 130, 90, 0.12);
  --shadow-sm: 2px 3px 0 rgba(120, 98, 56, 0.12);
  --shadow: 3px 5px 0 rgba(120, 98, 56, 0.15);
  --shadow-lg: 6px 9px 0 rgba(120, 98, 56, 0.18);
  --nav-bg: rgba(251, 247, 237, 0.86);
  --nav-pill-bg: #fffdf4;
  --focus-ring: rgba(232, 90, 122, 0.42);
  --code-bg: #2b2620;
  --code-text: #f5f1e8;
  --inline-code: #c2441f;
  --button-text-on-accent: #fffdf4;
  --radius-sm: 9px;
  --radius: 13px;
  --radius-lg: 16px;
  --page-glow: none;
  /* 手写标题字体：马善政楷体为主，站酷快乐体/系统楷体兜底 */
  --font-hand: "Ma Shan Zheng", "ZCOOL KuaiLe", "KaiTi", "STKaiti", "Kaiti SC", "楷体", cursive;
  --font-hand-cn: "ZCOOL KuaiLe", "KaiTi", "STKaiti", "Kaiti SC", "楷体", cursive;
  /* 玻璃拟态保留为「手账纸片」质感，不再使用高光扫掠 */
  --glass-tint: rgba(255, 253, 246, 0.92);
  --glass-sheen: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.4),
    rgba(255, 255, 255, 0) 55%
  );
  --glass-rim-top: rgba(58, 50, 38, 0.18);
  --glass-rim-bottom: rgba(58, 50, 38, 0.06);
  --glass-backdrop: saturate(100%) blur(6px);
  --glass-inner-glow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  /* Shared material definitions: dividers and photo edges */
  --hairline: color-mix(in srgb, var(--border) 72%, transparent);
  --edge: color-mix(in srgb, var(--ink) 55%, transparent);
  /* Motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-soft: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.76, 0, 0.24, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --t-fast: 0.22s;
  --t-base: 0.4s;
  --t-slow: 0.7s;
  --floating-edge: clamp(1rem, 4vw, 2rem);
}

.markdown-preview-dark {
  color-scheme: dark;
  /* 黄昏手账：整体调亮，像台灯下/黄昏时的牛皮纸本 */
  --bg: #4a4034;
  --bg-tint: #554a3d;
  --surface: #5e5345;
  --surface-muted: #6b5f50;
  --text: #f8f4ed;
  --text-muted: #d8d0c0;
  --text-faint: #b0a690;
  --border: #7d7060;
  --border-strong: #968778;
  --accent: #f8f4ed;
  --accent-strong: #fffbf5;
  --accent-soft: #6b5f50;
  --accent-line: rgba(248, 244, 237, 0.32);
  --brand: #f0a3b8;
  --brand-soft: rgba(240, 163, 184, 0.22);
  /* 黄昏便签色：比夜间更亮、更暖，保持手账感 */
  --sticky-yellow: #d4b978;
  --sticky-cyan: #7fbfb6;
  --sticky-pink: #d49ba6;
  --sticky-green: #a6bc7e;
  --sticky-purple: #b5a6ce;
  --ink: #f8f4ed;
  --paper-line: rgba(248, 244, 237, 0.1);
  --shadow-sm: 2px 3px 0 rgba(0, 0, 0, 0.22);
  --shadow: 3px 5px 0 rgba(0, 0, 0, 0.26);
  --shadow-lg: 6px 9px 0 rgba(0, 0, 0, 0.3);
  --nav-bg: rgba(74, 64, 52, 0.9);
  --nav-pill-bg: #5e5345;
  --focus-ring: rgba(240, 163, 184, 0.45);
  --code-bg: #17130c;
  --code-text: #f0e8d8;
  --inline-code: #f0a279;
  --button-text-on-accent: #211b12;
  --page-glow: none;
  --glass-tint: rgba(59, 49, 35, 0.92);
  --glass-sheen: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.06),
    rgba(255, 255, 255, 0) 55%
  );
  --glass-rim-top: rgba(240, 232, 216, 0.16);
  --glass-rim-bottom: rgba(240, 232, 216, 0.05);
  --glass-backdrop: saturate(100%) blur(6px);
  --glass-inner-glow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

* {
  box-sizing: border-box;
}

html {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
  scroll-behavior: smooth;
  scroll-padding-top: 6.5rem;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
}

body {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  margin: 0;
  min-width: 320px;
  /* 米黄手账纸底 + 淡横向内页格线 */
  background-color: var(--bg);
  background-image: linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(1.95rem - 1px),
    var(--paper-line) calc(1.95rem - 1px),
    var(--paper-line) 1.95rem
  );
  background-attachment: fixed;
}

main {
  flex: 1;
  width: min(100% - 2.5rem, 63rem);
  margin: 0 auto;
  padding: 7rem 0 5rem;
}

.home-page main {
  padding-top: 8.25rem;
}

a {
  color: inherit;
  text-decoration: none;
  transition: color var(--t-fast) var(--ease-out);
}

a:hover {
  color: var(--accent);
}

:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
  border-radius: 4px;
}

/* Keyboard users: first Tab reveals a jump-to-content pill under the nav */
.skip-link {
  position: fixed;
  top: 0.85rem;
  left: 50%;
  z-index: 100;
  padding: 0.5rem 1.15rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--button-text-on-accent);
  font-size: 0.9rem;
  font-weight: 650;
  box-shadow: var(--shadow);
  translate: -50% calc(-100% - 1.5rem);
  transition: translate var(--t-fast) var(--ease-out);
}

.skip-link:focus-visible {
  translate: -50% 0;
  outline-offset: 2px;
}

img {
  max-width: 100%;
}

h1,
h2,
h3 {
  margin: 0;
  line-height: 1.16;
  letter-spacing: -0.018em;
  font-weight: 760;
  text-wrap: balance;
}

p {
  margin: 0;
}

::selection {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

/* Brand-tinted selection where color-mix is supported (keeps text colors) */
@supports (background: color-mix(in srgb, red 10%, transparent)) {
  ::selection {
    background: color-mix(in srgb, var(--brand) 22%, transparent);
    color: inherit;
  }
}

/* Slim, theme-aware scrollbars (standard properties only — Safari keeps
   its native overlay bars, which is the right behavior there) */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.post-content pre {
  scrollbar-color: rgba(255, 255, 255, 0.24) transparent;
}

/* ---------- Navigation ---------- */
.site-nav {
  position: fixed;
  inset: 0 0 auto;
  z-index: 20;
  padding: 0.85rem 1rem;
  background: transparent;
  pointer-events: none;
  /* Persistence is for DOM/state only. Keeping the glass navigation out of an
     isolated view-transition snapshot avoids a rectangular backdrop-filter
     raster appearing around the rounded pill. */
  view-transition-name: none !important;
}

.site-nav__pill {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.3rem;
  background: var(--nav-pill-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow);
  pointer-events: auto;
  translate: 0 -0.18rem;
  view-transition-name: none !important;
}

.site-nav__indicator {
  position: absolute;
  inset: 50% auto auto 0;
  z-index: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent);
  opacity: 0;
  pointer-events: none;
  transform: translateX(0) translateY(-50%);
  transform-origin: center;
  will-change: transform;
}

.site-nav__pill.has-indicator .site-nav__indicator {
  opacity: 1;
}

.site-nav__pill.is-indicator-ready .site-nav__indicator {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    width 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    height 0.2s var(--ease-out), opacity 0.14s var(--ease-out);
}

.site-nav__pill > :not(.site-nav__indicator) {
  position: relative;
  z-index: 1;
}

/* Liquid glass: translucent tint with a light sweep, refraction-style gradient
   rim and an inner glow. Browsers without backdrop-filter keep the solid pill. */
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .site-nav__pill {
    background: var(--glass-sheen), var(--glass-tint);
    border-color: transparent;
    -webkit-backdrop-filter: var(--glass-backdrop);
    backdrop-filter: var(--glass-backdrop);
    box-shadow: var(--glass-inner-glow), var(--shadow);
  }

  /* Gradient rim — bright where light hits the top edge, fading below */
  .site-nav__pill::before {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(180deg, var(--glass-rim-top), var(--glass-rim-bottom));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    pointer-events: none;
  }

  /* Chips stay translucent so the glass reads through them */
  .site-nav__pill a:hover,
  .site-nav__pill .site-nav__icon:hover {
    background: color-mix(in srgb, var(--surface-muted) 62%, transparent);
  }

  .site-nav__pill a.is-current,
  .site-nav__pill .site-nav__icon.is-current {
    background: color-mix(in srgb, var(--accent-soft) 78%, transparent);
  }
}

.site-nav__pill a {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.42rem 0.95rem;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: normal;
  text-align: center;
  transition: color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.site-nav__pill a:active {
  scale: 0.94;
}

.site-nav__pill a:hover {
  color: var(--text);
  background: var(--surface-muted);
}

.site-nav__pill a.is-current {
  color: var(--accent);
  background: var(--accent-soft);
}

/* A route fetch happens before Astro starts the visual swap. Reflect the click
   immediately so the navigation never feels frozen while that preparation is
   happening. aria-current is still updated only after the URL really changes. */
.site-nav__pill a.is-pending {
  color: var(--accent);
  background: var(--accent-soft);
}

.site-nav__pill a[data-nav-route].is-current,
.site-nav__pill a[data-nav-route].is-pending {
  background: transparent;
}

.site-nav__sep {
  width: 1px;
  height: 1.15rem;
  margin: 0 0.3rem;
  background: var(--border);
}

.site-nav__pill .site-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
}

.site-nav__pill .site-nav__icon:hover {
  color: var(--text);
  background: var(--surface-muted);
}

.site-nav__pill .site-nav__icon.is-current {
  color: var(--accent);
  background: var(--accent-soft);
}

.site-nav__pill .site-nav__icon svg {
  transition: rotate var(--t-base) var(--ease-spring),
    scale var(--t-base) var(--ease-spring);
}

.site-nav__pill .site-nav__icon:hover svg {
  rotate: 10deg;
}

.site-nav__pill .site-nav__icon:active svg {
  scale: 0.82;
}

.theme-toggle {
  position: relative;
  display: grid !important;
  place-items: center;
}

.theme-toggle :is(.theme-toggle__moon, .theme-toggle__sun) {
  grid-area: 1 / 1;
  transition: opacity 0.26s var(--ease-out), rotate 0.46s var(--ease-out-soft),
    scale 0.4s var(--ease-out-soft) !important;
  will-change: opacity, rotate, scale;
}

.theme-toggle .theme-toggle__moon {
  opacity: 1;
  rotate: 0deg;
  scale: 1;
}

.theme-toggle .theme-toggle__sun {
  opacity: 0;
  rotate: -78deg;
  scale: 0.56;
}

.theme-toggle[data-theme-icon="dark"] .theme-toggle__moon {
  opacity: 0;
  rotate: 72deg;
  scale: 0.56;
}

.theme-toggle[data-theme-icon="dark"] .theme-toggle__sun {
  opacity: 1;
  rotate: 0deg;
  scale: 1;
}

.theme-toggle.is-switching {
  color: var(--brand) !important;
}

/* ---------- Hero (intro left + picks right, vertically balanced) ---------- */
.hero {
  margin-bottom: 4.5rem;
  padding-top: 0.75rem;
}

.hero__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.hero__avatar {
  width: 4.5rem;
  height: 4.5rem;
  margin-bottom: 1.1rem;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border), var(--shadow);
  transition: rotate var(--t-base) var(--ease-spring),
    scale var(--t-base) var(--ease-spring);
}

.hero__avatar:hover {
  rotate: -4deg;
  scale: 1.06;
}

.hero__title {
  margin-top: 0.35rem;
  font-size: clamp(2.1rem, 5vw, 3.4rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

/* Ink-gradient display titles — the type itself carries the depth */
@supports (color: color-mix(in srgb, red 50%, transparent)) {
  .hero__title,
  .article__header h1,
  .page-header h1,
  .about__lead {
    background: linear-gradient(
      180deg,
      var(--text) 52%,
      color-mix(in srgb, var(--text) 58%, transparent)
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .about__lead em {
    -webkit-text-fill-color: var(--brand);
  }
}

.hero__bio {
  max-width: 38rem;
  margin-top: 0.85rem;
  color: var(--text-muted);
  font-size: 1.06rem;
  line-height: 1.65;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1.1rem;
  margin-top: 1.6rem;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--brand);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

/* Text links (not buttons) */
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text);
  font-weight: 650;
  font-size: 0.98rem;
}

.text-link svg {
  transition: transform var(--t-fast) var(--ease-out);
}

.text-link:hover {
  color: var(--brand);
}

.text-link:hover svg {
  transform: translateX(3px);
}

/* "查看全部" link under a section list */
.section__more {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1.6rem;
  color: var(--text-muted);
  font-weight: 650;
  font-size: 0.95rem;
  transition: color var(--t-fast) var(--ease-out);
}

.section__more svg {
  transition: transform var(--t-fast) var(--ease-out);
}

.section__more:hover {
  color: var(--brand);
}

.section__more:hover svg {
  transform: translateX(3px);
}

/* Icon social buttons */
.hero__social {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: 0.4rem;
  padding-left: 0.95rem;
  border-left: 1px solid var(--border);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  color: var(--text-muted);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.icon-button:hover {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
  transform: translateY(-2px);
}

.icon-button:active {
  transform: translateY(0) scale(0.92);
}

/* ---------- Section headers ---------- */
.section {
  margin-top: 4rem;
}

.section__header {
  margin-bottom: 1.5rem;
}

.section__header h2 {
  font-size: clamp(1.5rem, 3vw, 1.9rem);
  letter-spacing: -0.02em;
}

.section__header p {
  margin-top: 0.4rem;
  max-width: 40rem;
  color: var(--text-muted);
  font-size: 0.98rem;
}

/* Title left, "view all" on the same baseline right */
.section__header--row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.section__header--row .section__more {
  margin-top: 0;
  margin-bottom: 0.2rem;
  white-space: nowrap;
}

/* ---------- Hero picks (horizontal row below intro) ---------- */
.hero__picks {
  margin-top: 2.5rem;
  padding-top: 1.6rem;
  border-top: 1px solid var(--border);
}

.hero__picks-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.hero__picks-label::before {
  content: "";
  width: 3px;
  height: 0.95em;
  border-radius: 3px;
  background: var(--brand);
}

/* Editorial picks: one lead story, a quiet list beside it */
.picks {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 1.4rem 2.75rem;
  align-items: start;
}

.pick-hero {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pick-hero__thumb {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  margin-bottom: 0.5rem;
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  background: var(--surface-muted);
  box-shadow: 0 10px 26px rgba(20, 24, 32, 0.09);
  transition: translate var(--t-base) var(--ease-spring),
    box-shadow var(--t-base) var(--ease-out);
}

.pick-hero__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: scale var(--t-slow) var(--ease-out-soft);
}

.pick-hero:hover .pick-hero__thumb {
  translate: 0 -0.25rem;
  box-shadow: 0 16px 34px rgba(20, 24, 32, 0.13);
}

.pick-hero:hover .pick-hero__thumb img {
  scale: 1.03;
}

.pick-hero__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text);
  font-size: 1.3rem;
  font-weight: 760;
  line-height: 1.38;
  letter-spacing: -0.015em;
  transition: color var(--t-fast) var(--ease-out);
}

.pick-hero:hover .pick-hero__title {
  color: var(--brand);
}

.pick-hero__desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 0.93rem;
  line-height: 1.6;
}

.pick-side {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.pick-side__item {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 0.95rem;
  align-items: center;
  padding: 0.8rem 0;
}

.pick-side li:first-child .pick-side__item {
  padding-top: 0.15rem;
}

.pick-side li + li .pick-side__item {
  border-top: 1px solid var(--hairline);
}

.pick-side__thumb {
  display: block;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  border: 1px solid var(--edge);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}

.pick-side__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: scale var(--t-slow) var(--ease-out-soft);
}

.pick-side__item:hover .pick-side__thumb img {
  scale: 1.05;
}

.pick-side__text {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
}

.pick-side__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text);
  font-size: 0.93rem;
  font-weight: 650;
  line-height: 1.45;
  transition: color var(--t-fast) var(--ease-out);
}

.pick-side__item:hover .pick-side__title {
  color: var(--brand);
}

.pick-side__date {
  color: var(--text-faint);
  font-size: 0.76rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pick__thumb--fallback {
  background: linear-gradient(
    140deg,
    hsl(var(--h, 24) 32% 60%),
    hsl(calc(var(--h, 24) + 18) 36% 48%)
  );
}

/* ---------- Post meta ---------- */
.post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.7rem;
  align-items: center;
  color: var(--text-faint);
  font-size: 0.8rem;
  font-weight: 600;
}

.post-meta span:first-child {
  color: var(--brand);
  letter-spacing: 0.01em;
}

/* ---------- Post ledger (typographic rows: date · title · category) ---------- */
.post-list {
  display: flex;
  flex-direction: column;
}

.post-row {
  position: relative;
}

/* Divider spans the content width; the hover block's rounded corners bleed
   into the gutter (outside this line), so there's no notch. */
.post-row + .post-row::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--hairline);
  pointer-events: none;
}

.post-row a {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 4.3rem minmax(0, 1fr);
  gap: 1.1rem;
  align-items: start;
  padding: 1.05rem 0.75rem;
  margin-inline: -0.75rem;
  border-radius: var(--radius-sm);
  transition: background var(--t-fast) var(--ease-out);
}

.post-row--plain a {
  grid-template-columns: minmax(0, 1fr);
}

.post-row a:hover {
  background: var(--bg-tint);
}

.post-row__date {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding-top: 0.18rem;
  font-variant-numeric: tabular-nums;
}

.post-row__md {
  color: var(--text-muted);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.post-row__yy {
  color: var(--text-faint);
  font-size: 0.72rem;
  font-weight: 600;
}

.post-row__main {
  min-width: 0;
}

.post-row__line {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
}

.post-row h3 {
  flex: 1;
  min-width: 0;
  font-size: 1.06rem;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.01em;
  transition: color var(--t-fast) var(--ease-out);
}

.post-row__cat {
  flex: none;
  color: var(--brand);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.post-row a:hover h3 {
  color: var(--brand);
}

.post-row p {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 0.3rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.6;
}

/* Compact rows (archive / category / tag): a pure index — title is the row */
.post-row--compact a {
  padding-block: 0.85rem;
}

.post-row--compact .post-row__date {
  padding-top: 0.14rem;
}

/* ---------- Tags ---------- */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.2rem;
}

.tag-list span {
  padding: 0.16rem 0.6rem;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 600;
}

/* ---------- Taxonomy (open, borderless) ---------- */
.taxonomy-overview,
.archive-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.75rem 3rem;
  align-items: start;
}

.taxonomy-panel {
  padding-top: 1.1rem;
  border-top: 1px solid var(--border);
}

.taxonomy-panel h2,
.taxonomy-panel h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.taxonomy-panel h2 svg,
.taxonomy-panel h3 svg {
  color: var(--brand);
}

.term-list,
.term-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.term-list a,
.term-switcher a {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.34rem 0.45rem 0.34rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.2;
  transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.term-list a:active,
.term-switcher a:active {
  scale: 0.95;
}

.term-list a:hover,
.term-switcher a:hover,
.term-switcher a.is-current {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.term-list small,
.term-switcher small {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.term-list a:hover small,
.term-switcher a:hover small {
  background: var(--surface);
  color: var(--accent);
}

/* Collapsible long tag tail — smooth height via grid-template-rows */
.term-more {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--t-base) var(--ease-out),
    margin-top var(--t-base) var(--ease-out);
}

.term-more.is-open {
  grid-template-rows: 1fr;
  margin-top: 0.5rem;
}

.term-more > .term-list--rest {
  overflow: hidden;
  min-height: 0;
}

.term-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.85rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease-out);
}

.term-toggle:hover {
  color: var(--brand);
}

.term-toggle__chev {
  transition: transform var(--t-base) var(--ease-out);
}

.term-toggle.is-open .term-toggle__chev {
  transform: rotate(180deg);
}

/* ---------- Generic content pages ---------- */
.archive-page {
  width: 100%;
  margin: 0 auto;
}

/* No TOC: a single, centered reading column (header + body). */
.article {
  width: min(100%, 44rem);
  margin: 0 auto;
}

/* With TOC: full-width masthead header, then content + sticky TOC sidebar
   that together span the homepage width — no focus jump when entering. */
.article--toc {
  width: min(100%, 68rem);
}

.article--toc .article__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(14rem);
  gap: 3.5rem;
  align-items: start;
}

.article__aside {
  position: sticky;
  top: 6.5rem;
}

.page-header {
  margin-bottom: 2.5rem;
}

.page-header h1 {
  margin: 0.5rem 0 0.7rem;
  font-size: clamp(2rem, 5vw, 3rem);
}

.page-header p:last-child {
  max-width: 38rem;
  color: var(--text-muted);
}

.search-page {
  width: 100%;
  margin: 0 auto;
}

/* ---------- 404 ---------- */
.not-found-page {
  width: min(100%, 640px);
  margin: 4rem auto 0;
  text-align: center;
}

.not-found-page h1 {
  margin: 0.5rem 0 1rem;
  font-size: clamp(3rem, 12vw, 6rem);
  letter-spacing: -0.04em;
}

.not-found-page > p:not(.eyebrow) {
  margin: 0 auto 1.6rem;
  max-width: 30rem;
  color: var(--text-muted);
}

.not-found-page .eyebrow {
  justify-content: center;
}

.not-found-page .button-row {
  justify-content: center;
}

/* ---------- Search ---------- */
.search-box {
  margin-bottom: 1.5rem;
}

.search-box label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.search-box__control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.6rem;
}

.search-box input,
.search-box button {
  min-height: 2.9rem;
  border-radius: var(--radius-sm);
  font: inherit;
}

.search-box input {
  width: 100%;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  transition: border-color var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
}

.search-box input:focus {
  outline: none;
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.search-box button {
  padding: 0.5rem 1.3rem;
  border: 0;
  background: var(--accent);
  color: var(--button-text-on-accent);
  font-weight: 700;
  cursor: pointer;
  transition: filter var(--t-fast) var(--ease-out);
}

.search-box button:hover {
  filter: brightness(1.05);
}

.search-status {
  margin: 0 0 1rem;
  color: var(--text-muted);
  font-size: 0.92rem;
}

/* ---------- Archive ---------- */
.archive-summary {
  margin-bottom: 2.25rem;
  grid-template-columns: 1fr;
}

.term-switcher {
  margin-bottom: 1.5rem;
}

/* Year as a large outlined numeral in its own gutter, entries beside it */
.archive-year {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 0 2rem;
  align-items: start;
  margin-top: 3rem;
}

.archive-year__head {
  position: sticky;
  top: 6.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-top: 1.05rem;
}

.archive-year__num {
  margin: 0;
  color: var(--text);
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.archive-year__count {
  color: var(--text-faint);
  font-size: 0.84rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.button-row a {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem 0.5rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font-weight: 650;
  font-size: 0.92rem;
  transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.button-row a:active {
  scale: 0.96;
}

.button-row a svg {
  color: var(--text-muted);
  transition: color var(--t-fast) var(--ease-out);
}

.button-row a:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.button-row a:hover svg {
  color: var(--accent);
}

/* ---------- About page ---------- */
.about {
  width: 100%;
}

.about__intro {
  max-width: 52rem;
  margin-bottom: 3.75rem;
}

.about__avatar {
  width: 3.6rem;
  height: 3.6rem;
  margin-bottom: 1.2rem;
  border: 3px solid var(--surface);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 0 0 1px var(--border), var(--shadow);
  transition: rotate var(--t-base) var(--ease-spring),
    scale var(--t-base) var(--ease-spring);
}

.about__avatar:hover {
  rotate: -4deg;
  scale: 1.06;
}

.about__intro .eyebrow {
  margin-bottom: 1.3rem;
}

.about__lead {
  font-size: clamp(2rem, 4.4vw, 3.1rem);
  font-weight: 780;
  line-height: 1.28;
  letter-spacing: -0.03em;
}

.about__lead em {
  font-style: normal;
  color: var(--brand);
}


.about__sub {
  max-width: 38rem;
  margin-top: 1.4rem;
  color: var(--text-muted);
  font-size: 1.1rem;
  line-height: 1.7;
}

.about__sub em {
  font-style: normal;
  font-weight: 600;
  color: var(--brand);
}

/* Quiet facts strip under the lead — anchors the page with a few numbers */
.about__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem 1.9rem;
  margin-top: 2.2rem;
}

.about__fact {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.about__fact::before {
  content: "";
  width: 3px;
  height: 0.95em;
  border-radius: 3px;
  background: var(--brand);
  opacity: 0.85;
}

.about__social {
  display: inline-flex;
  gap: 0.4rem;
  margin-left: auto;
}

@media (max-width: 700px) {
  .about__social {
    width: 100%;
    margin-left: 0;
  }
}

/* ---------- Projects directory ---------- */
.proj-section {
  margin-top: 3.25rem;
  padding-top: 1.7rem;
  border-top: 1px solid var(--border);
}

.proj-section__head {
  margin-bottom: 1.6rem;
}

.proj-section__label {
  margin-bottom: 0.6rem;
  color: var(--brand);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.proj-section__desc {
  max-width: 40rem;
  color: var(--text-muted);
  font-size: 0.96rem;
  line-height: 1.6;
}

.proj-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem 2.5rem;
}

.proj {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  padding: 1.25rem 0.9rem;
  margin-inline: -0.9rem;
  border-radius: var(--radius-sm);
  transition: background var(--t-fast) var(--ease-out);
}

.proj:hover {
  background: var(--bg-tint);
}

.proj__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-muted);
  transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out),
    scale var(--t-base) var(--ease-spring), rotate var(--t-base) var(--ease-spring);
}

.proj:hover .proj__icon {
  color: var(--brand);
  border-color: var(--brand);
  scale: 1.08;
  rotate: -3deg;
}

.proj__body {
  min-width: 0;
}

.proj__owner {
  display: block;
  color: var(--text-faint);
  font-size: 0.78rem;
  font-weight: 700;
}

.proj__stars {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  margin-left: 0.4rem;
  color: var(--brand);
  font-weight: 700;
}

.proj__stars-icon {
  display: inline-flex;
  line-height: 0;
}

.proj__stars-icon svg {
  display: block;
  width: 0.82rem;
  height: 0.82rem;
  fill: currentColor;
  stroke: none;
}

.proj__title {
  margin: 0.12rem 0 0.4rem;
  font-size: 1.14rem;
  letter-spacing: -0.01em;
}

.proj__title a {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text);
  transition: color var(--t-fast) var(--ease-out);
}

.proj__go {
  color: var(--text-faint);
  transition: color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
}

.proj:hover .proj__title a {
  color: var(--brand);
}

.proj:hover .proj__go {
  color: var(--brand);
  transform: translate(2px, -2px);
}

.proj__desc {
  color: var(--text-muted);
  font-size: 0.94rem;
  line-height: 1.6;
}

.proj__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.9rem;
  margin-top: 0.85rem;
}

.proj__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.7rem;
}

.proj__tags small {
  color: var(--text-faint);
  font-size: 0.78rem;
  font-weight: 600;
}

.proj__note {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 650;
  transition: color var(--t-fast) var(--ease-out);
}

.proj__note:hover {
  color: var(--brand);
}

/* ---------- Article ---------- */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 2.2rem;
  color: var(--text-muted);
  font-size: 0.92rem;
  font-weight: 600;
}

.back-link__arrow {
  transform: rotate(180deg);
  transition: transform var(--t-fast) var(--ease-out);
}

.back-link:hover .back-link__arrow {
  transform: rotate(180deg) translateX(3px);
}

.article__header {
  margin-bottom: 2.5rem;
}

.article__header h1 {
  margin-top: 0.8rem;
  font-size: clamp(2rem, 5.5vw, 3.2rem);
  letter-spacing: -0.025em;
}

.article__header > p {
  margin-top: 1.1rem;
  color: var(--text-muted);
  font-size: 1.12rem;
  line-height: 1.6;
}

.article__header .tag-list {
  margin-top: 1.2rem;
}

.article__cover {
  display: block;
  width: 100%;
  height: auto;
  margin-top: 2rem;
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  background: var(--surface-muted);
  box-shadow: 0 10px 26px rgba(20, 24, 32, 0.09);
}

/* Cover inside the prose column (TOC articles) — flush top, space below before h2 */
.article__main > .article__cover {
  margin-top: 0;
  margin-bottom: 2.2rem;
}

.toc {
  margin: 0;
}

.toc h2 {
  margin-bottom: 0.7rem;
  padding-left: 0.85rem;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.toc ol {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.toc a {
  display: block;
  padding: 0.34rem 0 0.34rem 0.85rem;
  border-left: 2px solid var(--border);
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.5;
  transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out),
    padding-left var(--t-base) var(--ease-spring);
}

.toc a:hover {
  color: var(--brand);
  border-color: var(--brand);
}

/* Active: the rail stays one continuous line — only the text nudges right */
.toc a.is-active {
  color: var(--brand);
  border-color: var(--brand);
  font-weight: 700;
  padding-left: 1.03rem;
}

.toc__item--depth-3 a {
  padding-left: 1.85rem;
  font-size: 0.9rem;
}

.toc .toc__item--depth-3 a.is-active {
  padding-left: 2.03rem;
}

/* Progressive disclosure: a section's children stay tucked away until the
   reader is inside that section (same language as the notes time index). */
.toc__sub {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--t-base) var(--ease-out);
}

.toc__group:has(.is-active) .toc__sub {
  grid-template-rows: 1fr;
}

.toc__children {
  overflow: hidden;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease-out);
}

.toc__group:has(.is-active) .toc__children {
  opacity: 1;
}

/* ---------- Post content ---------- */
.post-content {
  font-size: 1.15rem;
  line-height: 1.8;
  overflow-wrap: break-word;
  text-wrap: pretty;
}

.post-content :is(h1, h2, h3) {
  margin-top: 2.8rem;
  margin-bottom: 0.85rem;
  letter-spacing: -0.02em;
  scroll-margin-top: 6.5rem;
}

.post-content h1 {
  font-size: 1.9rem;
}

.post-content h2 {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  font-size: 1.52rem;
  line-height: 1.28;
}

.post-content h2::before {
  content: "";
  flex: 0 0 auto;
  width: 0.38rem;
  height: 1.25em;
  border-radius: 999px;
  background: var(--brand);
}

.post-content h3 {
  margin-top: 2rem;
  color: var(--text);
  font-size: 1.2rem;
  font-weight: 750;
  line-height: 1.4;
}

.post-content p,
.post-content ul,
.post-content ol,
.post-content blockquote,
.post-content pre,
.post-content table,
.post-content details {
  margin: 1.5rem 0;
}

.post-content ul,
.post-content ol {
  padding-left: 1.4rem;
}

.post-content li + li {
  margin-top: 0.4rem;
}

.post-content li::marker {
  color: var(--brand);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.post-content a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--accent-line);
  text-underline-offset: 0.2em;
  transition: color var(--t-fast) var(--ease-out), text-decoration-color var(--t-fast) var(--ease-out);
}

.post-content a:hover {
  color: var(--brand);
  text-decoration-color: var(--brand);
}

.post-content img {
  display: block;
  height: auto;
  margin: 1.5rem auto;
  border-radius: var(--radius-sm);
}

.post-content img:not(.legacy-inline-image) {
  cursor: zoom-in;
}

.post-content .legacy-inline-image {
  display: inline-block;
  max-height: 2.4em;
  margin: 0 0.15em;
  vertical-align: middle;
  border-radius: 4px;
  cursor: auto;
}

/* ---------- Reading progress + back to top ---------- */
.reading-progress {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 30;
  height: 3px;
  pointer-events: none;
}

.reading-progress span {
  display: block;
  height: 100%;
  background: var(--brand);
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 0.1s linear;
}

.to-top {
  position: fixed;
  right: var(--floating-edge);
  bottom: calc(var(--floating-edge) + env(safe-area-inset-bottom, 0px) + 3.65rem);
  z-index: 25;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--nav-pill-bg);
  color: var(--text-muted);
  box-shadow: var(--shadow);
  cursor: pointer;
  opacity: 0;
  transform: translateY(10px) scale(0.92);
  pointer-events: none;
  transition: opacity var(--t-base) var(--ease-out-soft),
    transform var(--t-base) var(--ease-out-soft), color var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out);
}

.to-top.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .to-top {
    background: var(--glass-sheen), var(--glass-tint);
    border-color: var(--glass-rim-bottom);
    -webkit-backdrop-filter: var(--glass-backdrop);
    backdrop-filter: var(--glass-backdrop);
    box-shadow: var(--glass-inner-glow), var(--shadow);
  }
}

.to-top.is-visible:hover {
  color: var(--brand);
  border-color: var(--brand);
  transform: translateY(-3px) scale(1);
}

.to-top.is-visible:active {
  transform: translateY(-1px) scale(0.95);
}

/* ---------- Image lightbox ---------- */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: clamp(1rem, 4vw, 3rem);
  background: rgba(8, 10, 14, 0.55);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  cursor: zoom-out;
  opacity: 0;
  transition: opacity var(--t-base) var(--ease-out);
}

.lightbox.is-open {
  opacity: 1;
}

.lightbox img {
  max-width: min(100%, 1200px);
  max-height: 92vh;
  margin: 0;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  scale: 0.94;
  transition: scale var(--t-base) var(--ease-out-soft);
}

.lightbox.is-open img {
  scale: 1;
}

.post-content iframe {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 1.5rem 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.post-content pre {
  position: relative;
  padding: 1.1rem 1.2rem;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--code-bg);
  color: var(--code-text);
  line-height: 1.6;
  box-shadow: var(--shadow-sm);
}

.post-content pre:has(.copy-code-button) {
  padding-top: 2.8rem;
}

.copy-code-button {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 1;
  min-height: 1.8rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(245, 247, 251, 0.82);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
  transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
}

.copy-code-button:hover,
.copy-code-button.is-copied {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}

.copy-code-button:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

.post-content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", monospace;
  font-size: 0.9em;
}

.post-content :not(pre) > code {
  padding: 0.15em 0.4em;
  border-radius: 5px;
  background: var(--surface-muted);
  color: var(--inline-code);
  overflow-wrap: anywhere;
}

.post-content blockquote {
  position: relative;
  margin: 1.6rem 0;
  padding: 1rem 1.3rem 1rem 2.7rem;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--text-muted);
}

/* Decorative quote mark — reads clearly as a quote, not a heading bar */
.post-content blockquote::before {
  content: "\\201C";
  position: absolute;
  top: 0.45rem;
  left: 0.85rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.9rem;
  line-height: 1;
  color: var(--brand);
  opacity: 0.5;
}

.post-content blockquote > :first-child {
  margin-top: 0;
}

.post-content blockquote > :last-child {
  margin-bottom: 0;
}

/* Tables read like a printed index: horizontal rules only, no cell grid */
.post-content table {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.post-content th,
.post-content td {
  padding: 0.65rem 1rem 0.65rem 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.post-content th {
  border-bottom: 2px solid var(--border-strong);
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.post-content tr:last-child td {
  border-bottom-color: var(--hairline);
}

/* ---------- Article footer ---------- */
.article__footer {
  margin-top: 3.5rem;
  padding-top: 2.5rem;
  border-top: 1px solid var(--border);
}

/* Post navigation — directional strip, no card boxes */
.post-nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.post-nav__prev,
.post-nav__next {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1.4rem 0;
  color: var(--text);
  transition: color var(--t-fast) var(--ease-out);
}

.post-nav__prev {
  padding-right: 2.5rem;
  border-right: 1px solid var(--border);
}

.post-nav__next {
  padding-left: 2.5rem;
  text-align: right;
}

.post-nav__prev:hover,
.post-nav__next:hover {
  color: var(--brand);
}

.post-nav__prev span,
.post-nav__next span {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-faint);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: color var(--t-fast) var(--ease-out);
}

.post-nav__next span {
  justify-content: flex-end;
}

.post-nav__prev:hover span,
.post-nav__next:hover span {
  color: var(--brand);
}

.post-nav__prev span::before {
  content: "←";
  display: inline-block;
  font-size: 1.1em;
  line-height: 1;
  transition: translate var(--t-fast) var(--ease-spring);
}

.post-nav__next span::after {
  content: "→";
  display: inline-block;
  font-size: 1.1em;
  line-height: 1;
  transition: translate var(--t-fast) var(--ease-spring);
}

.post-nav__prev:hover span::before {
  translate: -3px 0;
}

.post-nav__next:hover span::after {
  translate: 3px 0;
}

.post-nav strong {
  display: block;
  font-size: 1.04rem;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: inherit;
}

/* Related articles — post-row style, no card boxes */
.related-posts {
  margin-top: 2.5rem;
}

.related-posts h2 {
  margin-bottom: 0.6rem;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.related-posts__grid {
  display: flex;
  flex-direction: column;
}

.related-posts__grid a {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.9rem 0.7rem;
  margin-inline: -0.7rem;
  border-radius: var(--radius-sm);
  color: var(--text);
  transition: background var(--t-fast) var(--ease-out);
}

.related-posts__grid a + a::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--hairline);
  pointer-events: none;
}

.related-posts__grid a:hover {
  background: var(--bg-tint);
}

.related-posts__grid span {
  color: var(--brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.related-posts__grid strong {
  display: block;
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.4;
  transition: color var(--t-fast) var(--ease-out);
}

.related-posts__grid a:hover strong {
  color: var(--brand);
}

.related-posts__grid small {
  display: block;
  color: var(--text-muted);
  font-size: 0.86rem;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- Legacy shortcode blocks ---------- */
.legacy-folding {
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.legacy-folding summary {
  cursor: pointer;
  font-weight: 700;
}

.legacy-secret {
  border-style: dashed;
}

.legacy-link-card,
.legacy-site-card {
  display: grid;
  gap: 0.75rem;
  margin: 1.2rem 0;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: border-color var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
}

.legacy-link-card:hover,
.legacy-site-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.legacy-site-card {
  grid-template-columns: 5.4rem minmax(0, 1fr);
  align-items: center;
}

.legacy-site-card img {
  width: 5.4rem;
  aspect-ratio: 16 / 10;
  margin: 0;
  border-radius: 6px;
  object-fit: cover;
}

.legacy-link-card span,
.legacy-site-card strong {
  display: block;
  font-weight: 700;
}

.legacy-link-card small,
.legacy-site-card small {
  display: block;
  margin-top: 0.2rem;
  color: var(--text-muted);
  font-size: 0.86rem;
}

/* ---------- Responsive ---------- */
@media (max-width: 860px) {
  main {
    width: min(100% - 1.75rem, 63rem);
    padding-top: 6.25rem;
  }

  .home-page main {
    padding-top: 7rem;
  }

  .site-footer__inner {
    width: min(100% - 1.75rem, 63rem);
  }

  .site-footer__bar {
    width: min(100% - 1.75rem, 63rem);
  }

  .article--toc .article__body {
    display: block;
  }

  .article__aside {
    display: none;
  }

  .notes-layout--indexed {
    display: block;
  }

  .notes-aside {
    display: none;
  }

  .hero {
    margin-bottom: 3.5rem;
  }

  .hero__avatar {
    width: 4.7rem;
    height: 4.7rem;
    margin-bottom: 1.1rem;
  }

  .picks {
    grid-template-columns: 1fr;
  }

  .taxonomy-overview,
  .archive-summary {
    grid-template-columns: 1fr;
  }

  .archive-year {
    display: block;
  }

  .archive-year__head {
    position: static;
    flex-direction: row;
    align-items: baseline;
    gap: 0.7rem;
    padding-top: 0;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--border);
  }

  .archive-year__num {
    font-size: 1.45rem;
    letter-spacing: -0.02em;
  }

  .proj-grid {
    grid-template-columns: 1fr;
  }

  .post-nav {
    grid-template-columns: 1fr;
  }

  .post-nav__prev {
    padding-right: 0;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .post-nav__next {
    padding-left: 0;
    text-align: left;
  }

  .post-nav__next span {
    justify-content: flex-start;
  }
}

@media (max-width: 560px) {
  .search-box__control {
    grid-template-columns: 1fr;
  }

  .post-row a {
    grid-template-columns: 3.4rem minmax(0, 1fr);
    gap: 0.8rem;
    padding-block: 0.95rem;
  }

  .post-row--plain a {
    grid-template-columns: minmax(0, 1fr);
  }

  .post-row__cat {
    display: none;
  }

  .legacy-site-card {
    grid-template-columns: 1fr;
  }

  .legacy-site-card img {
    width: 100%;
  }

  .hero__social {
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  }

  .toc {
    padding: 0.85rem;
  }

  .toc a {
    max-width: 100%;
    white-space: normal;
  }

  .post-content h2 {
    font-size: 1.35rem;
  }
}

@media (max-width: 460px) {
  .site-nav__pill {
    width: 100%;
    justify-content: center;
    gap: 0;
  }

  .site-nav__pill a {
    padding-inline: 0.7rem;
  }
}

/* ---------- Site footer ---------- */
.site-footer {
  margin-top: 6rem;
  border-top: 1px solid var(--border);
}

.site-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  width: min(100% - 2.5rem, 63rem);
  margin: 0 auto;
  padding: 2rem 0 1.8rem;
}

.site-footer__id {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.site-footer__avatar {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border);
}

.site-footer__id-text {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.site-footer__id-text strong {
  font-size: 0.97rem;
  font-weight: 750;
  color: var(--text);
}

.site-footer__id-text span {
  color: var(--text-faint);
  font-size: 0.82rem;
  font-weight: 500;
}

.site-footer__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.site-footer__links a,
.site-footer__item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 600;
  transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.site-footer__links a:active {
  scale: 0.96;
}

.site-footer__links a svg,
.site-footer__item svg {
  color: var(--brand);
}

.site-footer__item {
  color: var(--text-muted);
}

.site-footer__links a:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}

.site-footer__sep {
  display: inline-block;
  width: 1px;
  height: 1.4rem;
  background: var(--border);
  margin: 0 0.2rem;
}

.site-footer__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  width: min(100% - 2.5rem, 63rem);
  margin: 0 auto;
  padding: 1rem 0 2rem;
  border-top: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 0.8rem;
}

.site-footer__bar a {
  color: var(--text-faint);
  transition: color var(--t-fast) var(--ease-out);
}

.site-footer__bar a:hover {
  color: var(--brand);
}

/* ---------- Notes (随笔) timeline ---------- */
/* Three zones: date gutter · content · time index — fills the width, balanced */
.notes-layout--indexed {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(9rem);
  gap: 3rem;
  align-items: start;
}

.notes-aside {
  position: sticky;
  top: 6.5rem;
}

/* Time index: months smoothly expand for the year you're reading */
.notes-index__sub {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--t-base) var(--ease-out);
}

.notes-index__year:has(.is-active) .notes-index__sub {
  grid-template-rows: 1fr;
}

.notes-index__months {
  overflow: hidden;
  min-height: 0;
  padding-top: 0.1rem;
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease-out);
}

.notes-index__year:has(.is-active) .notes-index__months {
  opacity: 1;
}

.notes-feed {
  position: relative;
  margin-top: 2.8rem;
}

.notes-year {
  scroll-margin-top: 7rem;
}

.notes-year + .notes-year {
  margin-top: 2.8rem;
}

/* Year break: label + hairline reaching right across the full width */
.notes-year__label {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin: 0 0 1.6rem;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.notes-year__label::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* Delicate rail dividing the date gutter from the content */
.notes-feed::before {
  content: "";
  position: absolute;
  top: 0.7rem;
  bottom: 0.4rem;
  left: 8.4rem;
  width: 1px;
  background: var(--border);
}

/* Date in a left gutter, content on the right — uses the width, stays balanced */
.note {
  position: relative;
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  column-gap: 2.8rem;
  align-items: start;
  scroll-margin-top: 7rem;
}

.note + .note {
  margin-top: 2.6rem;
}

/* Date dot on the rail, aligned with the entry's first line */
.note::before {
  content: "";
  position: absolute;
  left: 8.13rem;
  top: 0.5rem;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 0 4px var(--bg);
}

.note__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding-top: 0.1rem;
  font-size: 0.85rem;
}

.note__meta time {
  font-weight: 650;
  color: var(--text-muted);
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.note__mood {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
}

.note__mood svg {
  flex: none;
  color: var(--brand);
}

.note__mood-text {
  color: var(--text-faint);
}

.note__main {
  max-width: 46rem;
}

.note__main > :first-child {
  margin-top: 0;
}

.note__title {
  margin: 0 0 0.5rem;
  font-size: 1.18rem;
  font-weight: 750;
  letter-spacing: -0.01em;
  line-height: 1.4;
}

.note__body > :first-child {
  margin-top: 0;
}

.note__body > :last-child {
  margin-bottom: 0;
}

.note__tags {
  margin-top: 1rem;
}

/* Collapse the date gutter on small screens */
@media (max-width: 600px) {
  .notes-feed::before,
  .note::before {
    display: none;
  }

  .note {
    grid-template-columns: 1fr;
    row-gap: 0.5rem;
  }

  .note__meta {
    flex-direction: row;
    align-items: center;
    gap: 0.6rem;
  }

  .note__main {
    max-width: none;
  }
}

.notes-empty {
  margin-top: 3rem;
  color: var(--text-muted);
}

/* ---------- Selection quote comments ---------- */
.qc-pop {
  position: absolute;
  inset: 0 auto auto 0;
  z-index: 30;
  padding: 0.38rem 0.72rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--accent);
  color: var(--button-text-on-accent);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.35;
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: opacity var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.qc-pop[hidden] {
  display: none;
}

.qc-pop:hover {
  opacity: 0.92;
}

.qc-pop:active {
  scale: 0.94;
}

/* Springy pop-in when the selection button appears */
@media (prefers-reduced-motion: no-preference) {
  .qc-pop:not([hidden]) {
    animation: qc-pop-in 0.34s var(--ease-spring) both;
  }
}

@keyframes qc-pop-in {
  from {
    opacity: 0;
    translate: 0 0.45rem;
    scale: 0.82;
  }
}

/* ---------- Custom comments (Twikoo backend, our own UI) ---------- */
.cbox {
  width: min(100%, 46rem);
  margin-top: 3.5rem;
  margin-right: auto;
  padding-top: 2.5rem;
  border-top: 1px solid var(--border);
}

.cbox__head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.cbox__title {
  font-size: 1.25rem;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.cbox__count {
  color: var(--text-faint);
  font-size: 0.95rem;
  font-weight: 600;
}

.cform {
  display: flex;
  gap: 0.85rem;
}

.cform__avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--surface-muted);
  color: var(--text-faint);
}

.cform__avatar svg {
  width: 1.35rem;
  height: 1.35rem;
}

.cform__main {
  flex: 1;
  min-width: 0;
}

.cform__text {
  width: 100%;
  box-sizing: border-box;
  min-height: 2.9rem;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
  transition: border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out);
}

.cform__text:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.cform__extra {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height var(--t-base) var(--ease-out),
    opacity var(--t-base) var(--ease-out), margin-top var(--t-base) var(--ease-out);
}

.cform.is-open .cform__extra {
  max-height: 14rem;
  opacity: 1;
  margin-top: 0.6rem;
}

.cform__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cform__meta input {
  flex: 1 1 8rem;
  min-width: 0;
  padding: 0.45rem 0.95rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  transition: border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out);
}

.cform__meta input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.cform__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.65rem;
}

.cform__hint {
  color: var(--text-faint);
  font-size: 0.78rem;
}

.cform__cancel {
  margin-left: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--brand);
  font: inherit;
  font-size: 0.78rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.cform__send {
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: var(--button-text-on-accent);
  padding: 0.5rem 1.5rem;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  transition: opacity var(--t-fast) var(--ease-out),
    translate var(--t-fast) var(--ease-spring), scale var(--t-fast) var(--ease-spring);
}

.cform__send:hover {
  opacity: 0.9;
  translate: 0 -1px;
}

.cform__send:active {
  scale: 0.95;
  translate: 0 0;
}

/* Accent buttons carry a whisper of light from above — Apple-style depth */
.cform__send,
.search-box button,
.qc-pop {
  background-image: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.16),
    rgba(255, 255, 255, 0) 60%
  );
}

.cform__status {
  margin: 0.7rem 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
}

.cform__status.is-error {
  color: var(--brand);
}

.clist {
  list-style: none;
  margin: 2rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.7rem;
}

.citem {
  display: flex;
  gap: 0.85rem;
}

.citem__avatar {
  flex: none;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--surface-muted);
  object-fit: cover;
}

.citem__body {
  flex: 1;
  min-width: 0;
}

.citem__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.citem__nick {
  font-size: 0.95rem;
  font-weight: 700;
}

.citem__badge {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 0.7rem;
  font-weight: 700;
}

.citem__re {
  color: var(--text-faint);
  font-size: 0.82rem;
}

.citem__time {
  color: var(--text-faint);
  font-size: 0.8rem;
}

.citem__content {
  margin: 0.35rem 0 0;
  color: var(--text);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.citem__content p {
  margin: 0.4rem 0;
}

.citem__content a {
  color: var(--brand);
}

.citem__content img {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.citem__actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.5rem;
}

.citem__act {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-faint);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease-out);
}

.citem__act:hover,
.citem__act.is-liked {
  color: var(--brand);
}

.citem__replies {
  list-style: none;
  margin: 1.2rem 0 0;
  padding: 0 0 0 0.6rem;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.citem--reply .citem__avatar {
  width: 2rem;
  height: 2rem;
}

.cbox__empty {
  margin: 1.5rem 0 0;
  color: var(--text-faint);
}

.cbox__empty[hidden],
.cbox__more[hidden] {
  display: none;
}

.cbox__more {
  display: block;
  margin: 1.6rem auto 0;
  padding: 0.45rem 1.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    scale var(--t-fast) var(--ease-spring);
}

.cbox__more:active {
  scale: 0.96;
}

.cbox__more:hover {
  border-color: var(--brand);
  color: var(--brand);
}

/* ---------- Motion: scroll reveal + theme crossfade ---------- */
@media (prefers-reduced-motion: no-preference) {
  .js :is(
    .hero__intro > *, .hero__picks,
    .section__header, .section__more, .post-row,
    .related-posts, .post-nav, .article__header > *, .article__main > .article__cover,
    .proj-section__head, .proj,
    .page-header, .archive-summary, .archive-year__head,
    .about__intro > *,
    .note
  ) {
    transition: opacity var(--t-slow) var(--ease-out-soft),
      transform var(--t-slow) var(--ease-out-soft);
    transition-delay: var(--reveal-delay, 0s);
  }

  .js :is(
    .hero__intro > *, .hero__picks,
    .section__header, .section__more, .post-row,
    .related-posts, .post-nav, .article__header > *, .article__main > .article__cover,
    .proj-section__head, .proj,
    .page-header, .archive-summary, .archive-year__head,
    .about__intro > *,
    .note
  ):not(.is-revealed) {
    opacity: 0;
    transform: translateY(1.25rem);
  }

  /* Masthead content settles into focus — blur lifts as it rises.
     (.js.js matches the (0,3,0) specificity of the main reveal selector —
     it contains \`.article__main > .article__cover\` — so this later rule
     wins and adds \`filter\` to the transition.) */
  .js.js :is(.hero__intro > *, .article__header > *) {
    transition: opacity var(--t-slow) var(--ease-out-soft),
      transform var(--t-slow) var(--ease-out-soft),
      filter var(--t-slow) var(--ease-out-soft);
    transition-delay: var(--reveal-delay, 0s);
  }

  .js.js :is(.hero__intro > *, .article__header > *):not(.is-revealed) {
    filter: blur(7px);
  }
}

/* Newly rendered comments cascade in (browsers with @starting-style) */
@media (prefers-reduced-motion: no-preference) {
  .citem {
    transition: opacity 0.55s var(--ease-out-soft), translate 0.55s var(--ease-out-soft);
  }

  .clist > .citem:nth-child(2) {
    transition-delay: 0.05s;
  }

  .clist > .citem:nth-child(3) {
    transition-delay: 0.1s;
  }

  .clist > .citem:nth-child(4) {
    transition-delay: 0.15s;
  }

  .clist > .citem:nth-child(n + 5) {
    transition-delay: 0.2s;
  }

  @starting-style {
    .citem {
      opacity: 0;
      translate: 0 0.6rem;
    }
  }
}

/* Article images develop in as the bytes arrive */
@media (prefers-reduced-motion: no-preference) {
  .js .post-content img:not(.legacy-inline-image) {
    opacity: 0.001;
    scale: 0.992;
    transition: opacity 0.6s var(--ease-out), scale 0.8s var(--ease-out-soft);
  }

  .js .post-content img.is-loaded {
    opacity: 1;
    scale: 1;
  }
}

/* ---------- Motion: client-side navigation ---------- */
/* Astro's documented pattern is used here: disable the page-wide transition
   on <html>, then animate only the named route content. This keeps persistent
   glass UI out of an opacity layer and uses fade-through (not crossfade), so
   old and new text are never legible at the same time. */
@keyframes blogRouteOut {
  from {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
  to {
    opacity: 0;
    transform: translate3d(0, -2px, 0);
  }
}

@keyframes blogRouteIn {
  from {
    opacity: 0;
    transform: translate3d(0, 4px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

::view-transition-group(page-content) {
  animation-duration: 200ms;
}

@media (prefers-reduced-motion: no-preference) {
  /* Astro's fallback runs the old and new phases sequentially. The delay is
     only needed when native View Transitions run both snapshots together. */
  html[data-astro-transition-fallback='new'] main {
    animation-delay: 0ms !important;
  }

  html[data-astro-transition] .site-nav__pill :is(a, .site-nav__icon, svg) {
    transition: none !important;
  }
}

/* Persist playback and navigation state without creating isolated snapshots
   for translucent/backdrop-filter elements. The root snapshot is disabled; the
   only animated snapshot is #main (page-content). */
.music-player {
  view-transition-name: none !important;
}

/* Theme switch: the new theme sweeps out of the toggle as an expanding circle.
   BaseLayout injects exact literal percentages for the button center and cover
   radius. Relative coordinates survive high-DPI view-transition rasterization
   without the half-size clip and final full-screen snap caused by px values. */
html.theme-vt::view-transition-old(root),
html.theme-vt::view-transition-new(root) {
  mix-blend-mode: normal;
}

html.theme-vt::view-transition-old(root) {
  animation: none;
  opacity: 1;
  z-index: 1;
}

html.theme-vt::view-transition-new(root) {
  /* A reveal circle needs a steady radius. The shared ease-out curve reaches
     97% by the halfway point, which makes the edge appear to pause before the
     view-transition snapshot is removed. */
  animation: theme-reveal 0.52s linear both;
  opacity: 1;
  z-index: 2;
}

/* The theme switch fires element-level color transitions (links, cards, …)
   which all finish in a burst around 250ms. That main-thread style/reflow
   wave starves the clip-path reveal — also main-thread driven — dropping its
   late frames, which reads as "smooth to halfway, then pop". Freeze those
   transitions for the reveal's duration: the root snapshot already carries
   the new theme, so the DOM snapping to final colors is invisible. */
html.theme-vt *,
html.theme-vt *::before,
html.theme-vt *::after {
  transition: none !important;
}

/* The route router normally isolates these persistent elements into their own
   snapshots. A theme reveal needs one coherent canvas, so fold them back into
   the root snapshot only for this transition. */
html.theme-vt :is(main, .site-nav, .site-nav__pill, .music-player) {
  view-transition-name: none !important;
}

html.theme-vt .theme-toggle {
  view-transition-name: theme-toggle !important;
}

html.theme-vt .theme-toggle svg {
  transition: none !important;
}

html.theme-vt::view-transition-group(theme-toggle) {
  z-index: 4;
  animation: none;
}

html.theme-vt::view-transition-old(theme-toggle) {
  animation: theme-toggle-out 0.18s ease-in both;
  mix-blend-mode: normal;
}

html.theme-vt::view-transition-new(theme-toggle) {
  animation: theme-toggle-in 0.46s 0.04s var(--ease-out-soft) both;
  mix-blend-mode: normal;
}

@keyframes theme-toggle-out {
  to {
    opacity: 0;
    transform: rotate(28deg) scale(0.72);
  }
}

@keyframes theme-toggle-in {
  from {
    opacity: 0;
    transform: rotate(-32deg) scale(0.62);
  }
  to {
    opacity: 1;
    transform: rotate(0deg) scale(1);
  }
}

/* Lightweight fallback: animate one composited layer instead of forcing every
   node on a long article to run four simultaneous color transitions. */
html.theme-anim body {
  animation: theme-settle 0.36s var(--ease-out-soft) both;
}

@keyframes theme-settle {
  from {
    opacity: 0.72;
    filter: saturate(0.82);
  }
  to {
    opacity: 1;
    filter: saturate(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }

  ::view-transition-group(*),
  ::view-transition-image-pair(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}

/* ======================================================================
   手账涂鸦风（Doodle Journal）—— 全站视觉覆盖层
   ====================================================================== */

/* 手绘卡片：不规则圆角 + 粗手绘描边 + 硬偏移投影（便签纸剪贴感） */
.doodle-card {
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

/* 撕纸毛边：顶部与底部带手工撕扯的锯齿 */
.doodle-torn {
  --tear: 6px;
  clip-path: polygon(
    0% var(--tear), 2% 0, 5% var(--tear), 8% 0, 11% var(--tear), 15% 0,
    19% var(--tear), 24% 0, 30% var(--tear), 37% 0, 44% var(--tear), 52% 0,
    60% var(--tear), 68% 0, 76% var(--tear), 83% 0, 89% var(--tear), 94% 0,
    98% var(--tear), 100% 0,
    100% calc(100% - var(--tear)), 98% 100%, 94% calc(100% - var(--tear)),
    89% 100%, 83% calc(100% - var(--tear)), 76% 100%, 68% calc(100% - var(--tear)),
    60% 100%, 52% calc(100% - var(--tear)), 44% 100%, 37% calc(100% - var(--tear)),
    30% 100%, 24% calc(100% - var(--tear)), 19% 100%, 15% calc(100% - var(--tear)),
    11% 100%, 8% calc(100% - var(--tear)), 5% 100%, 2% calc(100% - var(--tear)),
    0% 100%
  );
}

/* 手写标题：仿马克笔手写批注 */
.hero__title,
.article__header h1,
.page-header h1,
.about__lead,
.section__header h2,
.notes-year__label,
.proj-section__label,
.archive-year__num {
  font-family: var(--font-hand);
  font-weight: 400;
  letter-spacing: 0.01em;
}

/* 移除原「墨色渐变标题」的透明填充，让手写体以纯色呈现 */
@supports (color: color-mix(in srgb, red 50%, transparent)) {
  .hero__title,
  .article__header h1,
  .page-header h1,
  .about__lead {
    background: none;
    -webkit-background-clip: initial;
    background-clip: initial;
    -webkit-text-fill-color: var(--text);
  }
}

/* 马克笔批注效果：标题文字下方加一道荧光高亮划痕 */
.hero__title {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.hero__title::after {
  content: "";
  position: absolute;
  left: -0.08em;
  right: -0.08em;
  bottom: 0.04em;
  height: 0.32em;
  background: var(--sticky-yellow);
  opacity: 0.75;
  transform: rotate(-0.8deg);
  z-index: -1;
  border-radius: 0.1em 0.3em 0.12em 0.28em;
}

/* 章节标题：前置手绘画笔笔触 + 手绘波浪下划线 */
.section__header h2 {
  position: relative;
  display: inline-block;
}
.section__header h2::before {
  content: "";
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  margin-right: 0.4em;
  border-radius: 70% 30% 60% 40% / 40% 60% 30% 70%;
  background: var(--brand);
  transform: rotate(-8deg);
  vertical-align: baseline;
}
.section__header h2::after {
  content: "";
  position: absolute;
  left: 0;
  right: -0.15em;
  bottom: -0.28em;
  height: 0.28em;
  background: var(--sticky-cyan);
  opacity: 0.6;
  transform: rotate(-1deg) skewX(-8deg);
  border-radius: 0.15em 0.35em 0.2em 0.3em;
  z-index: -1;
}

/* eyebrow 小标签：手写 + 荧光笔色块 */
.eyebrow {
  font-family: var(--font-hand-cn);
  font-weight: 400;
  letter-spacing: 0.1em;
  padding: 0.05em 0.5em;
  background: var(--sticky-pink);
  color: var(--ink);
  border-radius: 0.3em 0.7em 0.35em 0.6em;
  transform: rotate(-1.2deg);
  text-transform: none;
}

/* 头像：撕纸毛边 + 手绘描边 */
.hero__avatar,
.about__avatar {
  border-radius: 48% 52% 45% 55% / 52% 46% 55% 45%;
  border: 2.5px solid var(--ink);
  box-shadow: 3px 4px 0 var(--shadow-sm);
  padding: 2px;
}

/* 导航 pill：实心手账纸条，替代玻璃拟态 */
.site-nav__pill {
  border: 2px solid var(--ink);
  border-radius: 14px 18px 15px 17px / 15px 13px 17px 15px;
  background: var(--nav-pill-bg);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}
@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .site-nav__pill {
    background: var(--nav-pill-bg);
    border-color: var(--ink);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: 3px 4px 0 var(--shadow-sm);
  }
  .site-nav__pill::before {
    display: none;
  }
}
.site-nav__pill a {
  border-radius: 8px 12px 9px 11px;
}
.site-nav__pill a.is-current,
.site-nav__pill a[data-nav-route].is-current {
  background: var(--sticky-yellow);
  color: var(--ink);
}
.site-nav__indicator {
  background: var(--sticky-yellow);
  box-shadow: none;
  border-radius: 8px 12px 9px 11px;
}

/* 文章列表行：便签纸条 */
.post-row a {
  border: 1.5px solid transparent;
  border-radius: 10px 14px 11px 13px;
}
.post-row a:hover {
  background: var(--sticky-yellow);
  border-color: var(--ink);
  color: var(--ink);
}
.post-row + .post-row::before {
  background: repeating-linear-gradient(
    90deg,
    transparent 0 6px,
    var(--hairline) 6px 10px
  );
  height: 1.5px;
}

/* 分类/标签「便利贴色块」：黄 / 青 / 粉 轮换 */
.tag-list span {
  border: 1px solid var(--ink);
  border-radius: 0.3em 0.6em 0.35em 0.55em;
  background: var(--sticky-yellow);
  color: var(--ink);
  transform: rotate(-1deg);
}
.tag-list span:nth-child(3n + 1) {
  background: var(--sticky-yellow);
}
.tag-list span:nth-child(3n + 2) {
  background: var(--sticky-cyan);
}
.tag-list span:nth-child(3n) {
  background: var(--sticky-pink);
}

/* 分类/标签面板与条目 */
.taxonomy-panel {
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  padding: 1.1rem;
  background: var(--surface);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}
.term-list a,
.term-switcher a {
  border: 1px solid var(--ink);
  border-radius: 0.3em 0.6em 0.35em 0.55em;
  background: var(--surface);
}
.term-list a:nth-child(3n + 1),
.term-switcher a:nth-child(3n + 1) {
  background: var(--sticky-yellow);
}
.term-list a:nth-child(3n + 2),
.term-switcher a:nth-child(3n + 2) {
  background: var(--sticky-cyan);
}
.term-list a:nth-child(3n),
.term-switcher a:nth-child(3n) {
  background: var(--sticky-pink);
}
.term-list a:hover,
.term-switcher a:hover,
.term-switcher a.is-current {
  border-color: var(--ink);
  background: var(--sticky-pink);
  color: var(--ink);
  transform: rotate(-1deg);
}

/* 项目卡片：便签纸 + 微倾斜 */
.proj {
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  background: var(--surface);
  box-shadow: 3px 4px 0 var(--shadow-sm);
  margin-inline: 0;
  padding: 1.1rem;
  transition: background var(--t-fast) var(--ease-out),
    transform var(--t-base) var(--ease-spring);
}
.proj:hover {
  background: var(--sticky-yellow);
  transform: rotate(-1.2deg) translateY(-2px);
}
.proj__icon {
  border-radius: 45% 55% 50% 50%;
  border-color: var(--ink);
}
.proj__tags small {
  padding: 0.1em 0.5em;
  border: 1px solid var(--border);
  border-radius: 0.3em 0.55em;
  background: var(--surface-muted);
}
.proj__tags small:nth-child(3n + 1) {
  background: var(--sticky-yellow);
}
.proj__tags small:nth-child(3n + 2) {
  background: var(--sticky-cyan);
}
.proj__tags small:nth-child(3n) {
  background: var(--sticky-pink);
}

/* ==================================================================
   随笔页：手账时间轴 + 交替便签卡片
   ================================================================== */

/* 时间轴线：手绘虚线，颜色更淡 */
.notes-feed::before {
  left: 8.4rem;
  width: 2px;
  background: transparent;
  border-left: 2px dashed var(--border);
  opacity: 0.55;
}

/* 年份标签：手写体 + 弱化分隔线 */
.notes-year__label {
  font-family: var(--font-hand-cn);
  font-size: 1.2rem;
  font-weight: 400;
  color: var(--text-muted);
}

.notes-year__label::after {
  height: 2px;
  background: transparent;
  border-bottom: 2px dashed var(--border);
  opacity: 0.5;
}

/* 时间轴上的节点：便签色圆点 */
.note::before {
  left: 8.05rem;
  top: 0.55rem;
  width: 0.65rem;
  height: 0.65rem;
  background: var(--sticky-yellow);
  border: 1.5px solid var(--ink);
  box-shadow: 1px 2px 0 var(--shadow-sm);
}

.note:nth-child(4n + 2)::before {
  background: var(--sticky-cyan);
}

.note:nth-child(4n + 3)::before {
  background: var(--sticky-pink);
}

.note:nth-child(4n)::before {
  background: var(--sticky-green);
}

/* 左侧日期：更像手账日期 */
.note__meta {
  align-items: flex-end;
  padding-top: 0.25rem;
  padding-right: 0.5rem;
  text-align: right;
}

.note__meta time {
  display: block;
  font-family: var(--font-hand-cn);
  font-size: 0.9rem;
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.note__mood {
  justify-content: flex-end;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.note__mood svg {
  color: var(--text-faint);
}

/* 便签卡片：交替四色 + 不规则圆角 + 倾斜 */
.note {
  background: transparent;
}

.note__main {
  max-width: 48rem;
}

.note__title {
  margin: 0 0 0.6rem;
  font-family: var(--font-hand-cn);
  font-size: 1.15rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--text);
}

.note__body {
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  box-shadow: 3px 4px 0 var(--shadow-sm);
  padding: 1.1rem 1.25rem;
  background: var(--surface);
  transform: rotate(-0.35deg);
  line-height: 1.75;
}

/* 四色循环便签 */
.note:nth-child(4n + 1) .note__body {
  background: var(--sticky-yellow);
  transform: rotate(-0.35deg);
}

.note:nth-child(4n + 2) .note__body {
  background: var(--sticky-cyan);
  transform: rotate(0.45deg);
}

.note:nth-child(4n + 3) .note__body {
  background: var(--sticky-pink);
  transform: rotate(-0.5deg);
}

.note:nth-child(4n) .note__body {
  background: var(--sticky-green);
  transform: rotate(0.35deg);
}

/* 卡片内文字颜色与便签协调 */
.note__body p,
.note__body li {
  color: var(--text);
}

.note__body a {
  color: var(--brand);
  text-decoration: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--brand);
  text-underline-offset: 0.15em;
}

/* 引用块：在便签卡片内更内敛 */
.note__body .post-content blockquote,
.post-content blockquote {
  border: 1.5px solid var(--ink);
  border-radius: 12px 18px 13px 16px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--ink);
  box-shadow: 2px 3px 0 var(--shadow-sm);
  transform: rotate(-0.4deg);
  padding: 0.9rem 1rem;
  margin: 1rem 0;
}

.note__body .post-content blockquote::before,
.post-content blockquote::before {
  content: "";
  display: none;
}

.note__body .post-content blockquote p:last-child,
.post-content blockquote p:last-child {
  margin-bottom: 0;
}

/* 列表项：手绘小圆点 */
.note__body ul {
  padding-left: 1.4em;
}

.note__body li::marker {
  color: var(--brand);
  font-size: 1.1em;
}

/* 标签：手账贴纸 */
.note__tags {
  margin-top: 0.9rem;
}

.note__tags span {
  display: inline-flex;
  align-items: center;
  padding: 0.25em 0.6em;
  border: 1.5px solid var(--ink);
  border-radius: 8px 12px 9px 11px;
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 1px 2px 0 var(--shadow-sm);
  font-family: var(--font-hand-cn);
  font-size: 0.8rem;
  transform: rotate(-0.5deg);
}

.note__tags span:nth-child(2n) {
  transform: rotate(0.5deg);
}

/* 右侧时间索引：便签风格 */
.notes-aside .toc {
  background: var(--surface);
  border: 1.5px solid var(--ink);
  border-radius: 12px 16px 13px 15px;
  box-shadow: 2px 3px 0 var(--shadow-sm);
  padding: 1rem;
  transform: rotate(0.5deg);
}

.notes-aside .toc h2 {
  font-family: var(--font-hand-cn);
  font-size: 1rem;
  font-weight: 400;
  color: var(--text);
  margin-bottom: 0.8rem;
  padding-bottom: 0.4rem;
  border-bottom: 2px dashed var(--border);
}

.notes-index__year > a {
  font-family: var(--font-hand-cn);
  color: var(--text-muted);
}

.notes-index__year.is-active > a,
.notes-index__year > a:hover {
  color: var(--brand);
}

/* 精选封面：撕纸毛边照片 */
.pick-hero__thumb,
.pick-side__thumb {
  border-radius: 255px 15px 255px 15px / 15px 255px 15px 255px;
  border: 2px solid var(--ink);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

/* 文章正文封面：撕纸 */
.article__cover {
  border-radius: 255px 15px 255px 15px / 15px 255px 15px 255px;
  border: 2px solid var(--ink);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

/* 正文图片：手绘描边 */
.post-content img,
.citem__content img {
  border: 2px solid var(--ink);
  border-radius: 10px 16px 11px 15px;
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

/* 正文小标题：手写体 + 手绘下划线（用现有竖条改造为画笔点） */
.post-content h2 {
  font-family: var(--font-hand);
  font-weight: 400;
  letter-spacing: 0;
}
.post-content h2::before {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 68% 32% 55% 45% / 45% 60% 40% 55%;
  transform: rotate(-6deg);
}
.post-content h3 {
  font-family: var(--font-hand);
  font-weight: 400;
}

/* 引用块：便利贴色块 */
.post-content blockquote {
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  background: var(--sticky-cyan);
  color: var(--ink);
  box-shadow: 3px 4px 0 var(--shadow-sm);
  transform: rotate(-0.6deg);
}
.post-content blockquote::before {
  color: var(--ink);
  opacity: 0.4;
}

/* 行内代码：手绘下划线高亮 */
.post-content :not(pre) > code {
  background: var(--sticky-yellow);
  color: var(--ink);
  border: 1px solid var(--border);
  border-radius: 0.3em 0.5em;
}

/* 代码块：牛皮纸深底，保留可读性 */
.post-content pre {
  border: 2px solid var(--ink);
  border-radius: 12px 16px 13px 15px;
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

/* 表格线：手绘虚线 */
.post-content th,
.post-content td {
  border-bottom: 1.5px dashed var(--border-strong);
}
.post-content th {
  border-bottom: 2px solid var(--ink);
}

/* 相邻文章导航：手绘箭头 */
.post-nav__prev,
.post-nav__next {
  border: 1.5px solid transparent;
  border-radius: 12px 16px 13px 15px;
}
.post-nav__prev:hover,
.post-nav__next:hover {
  background: var(--sticky-pink);
  border-color: var(--ink);
}

/* 相关文章行 */
.related-posts__grid a {
  border-radius: 10px 14px 11px 13px;
}
.related-posts__grid a:hover {
  background: var(--sticky-cyan);
}

/* 页脚：手绘分隔 + 手账标签 */
.site-footer {
  border-top: 2px dashed var(--border-strong);
}
.site-footer__links a,
.site-footer__item {
  border: 1px solid var(--ink);
  border-radius: 0.3em 0.6em 0.35em 0.55em;
  background: var(--surface);
}
.site-footer__links a:nth-child(3n + 1) {
  background: var(--sticky-yellow);
}
.site-footer__links a:nth-child(3n + 2) {
  background: var(--sticky-cyan);
}
.site-footer__links a:nth-child(3n) {
  background: var(--sticky-pink);
}
.site-footer__links a:hover {
  background: var(--sticky-pink);
  color: var(--ink);
}

/* 按钮 / 社交圆形按钮：手绘描边 */
.icon-button,
.button-row a,
.term-toggle {
  border: 1.5px solid var(--ink);
  border-radius: 45% 55% 50% 50% / 50% 45% 55% 50%;
  box-shadow: 2px 3px 0 var(--shadow-sm);
  background: var(--surface);
}
.icon-button:hover {
  background: var(--sticky-yellow);
  border-color: var(--ink);
  color: var(--ink);
}
.button-row a:hover {
  background: var(--sticky-cyan);
  border-color: var(--ink);
  color: var(--ink);
}

/* 搜索框 & 按钮 */
.search-box input {
  border: 2px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  background: var(--surface);
}
.search-box input:focus {
  border-color: var(--brand);
  box-shadow: 3px 4px 0 var(--brand-soft);
}
.search-box button {
  border: 2px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  background: var(--accent);
  box-shadow: 2px 3px 0 var(--shadow-sm);
}

/* 评论区表单 */
.cform__text,
.cform__meta input {
  border: 2px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  background: var(--surface);
}
.cform__send {
  border: 2px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  box-shadow: 2px 3px 0 var(--shadow-sm);
}

/* 首页 Hero 名片卡片（参考图居中手账卡片） */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 4rem;
  padding-top: 1rem;
}

.hero__card {
  position: relative;
  width: min(100%, 44rem);
  margin: 0 auto;
  padding: 2.5rem 2rem;
  text-align: center;
  background: var(--surface);
  border: 2px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  box-shadow: 4px 5px 0 var(--shadow-sm);
  transform: rotate(-0.6deg);
}

.hero__title {
  position: relative;
  display: inline-block;
  margin: 0 auto;
  font-size: clamp(2rem, 6vw, 3.2rem);
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: 0.02em;
}

.hero__title::after {
  content: "";
  position: absolute;
  left: -0.1em;
  right: -0.1em;
  bottom: 0.05em;
  height: 0.3em;
  background: var(--sticky-yellow);
  opacity: 0.75;
  transform: rotate(-1.2deg);
  border-radius: 0.1em 0.35em 0.12em 0.3em;
  z-index: -1;
}

.hero__name {
  color: var(--brand);
}

.hero__subtitle {
  margin-top: 0.8rem;
  color: var(--sticky-cyan);
  color: color-mix(in srgb, var(--sticky-cyan) 75%, var(--ink));
  font-family: var(--font-hand-cn);
  font-size: 0.95rem;
  letter-spacing: 0.08em;
}

.hero__subtitle::before,
.hero__subtitle::after {
  content: "✦";
  margin: 0 0.4em;
  color: var(--sticky-cyan);
  font-size: 0.8em;
}

.hero__bio {
  max-width: 34rem;
  margin: 1.2rem auto 0;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.8rem 1rem;
  margin-top: 1.8rem;
}

.hero__tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 1rem;
  border: 1.5px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  background: var(--sticky-yellow);
  box-shadow: 2px 3px 0 var(--shadow-sm);
  color: var(--ink);
  font-family: var(--font-hand-cn);
  font-size: 0.95rem;
  transform: rotate(-0.5deg);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.hero__tag:hover {
  color: var(--ink);
  transform: rotate(0deg) translateY(-2px);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

.hero__tag svg {
  transition: transform 0.2s ease;
}

.hero__tag:hover svg {
  transform: translateX(3px);
}

/* 手绘箭头装饰 */
.hero__arrow {
  position: absolute;
  top: 12%;
  left: 8%;
  width: 3.2rem;
  height: 2.6rem;
  background-image: url("data:image/svg+xml,%3Csvg width='52' height='42' viewBox='0 0 52 42' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 34 C18 10 36 6 46 12 M36 8 l4 -4 M44 14 l6 -6' stroke='%23e85a7a' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: contain;
  transform: rotate(-8deg);
  opacity: 0.85;
}

/* 圆点贴纸装饰 */
.hero__sticker {
  position: absolute;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  background: var(--sticky-yellow);
  border: 1.5px solid var(--ink);
  box-shadow: 1px 2px 0 var(--shadow-sm);
}

.hero__sticker--1 {
  bottom: 18%;
  left: 10%;
}

.hero__sticker--2 {
  width: 1rem;
  height: 1rem;
  top: 20%;
  right: 12%;
  background: var(--sticky-pink);
}

@media (max-width: 560px) {
  .hero__card {
    padding: 2rem 1.25rem;
  }

  .hero__arrow {
    left: 4%;
    width: 2.4rem;
    height: 2rem;
  }

  .hero__sticker--1 {
    left: 5%;
  }
}

/* doodle 手绘箭头点缀：作为 section__more / text-link 的装饰
   （用内联 SVG 波浪箭头作为标注） */
@supports (background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E")) {
  .hero__intro::before {
    content: "";
    display: block;
    width: 88px;
    height: 44px;
    margin-bottom: 0.4rem;
    background-image: url("data:image/svg+xml,%3Csvg width='88' height='44' viewBox='0 0 88 44' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 36 C30 8 60 6 82 10 M60 8 l6 -4 M70 12 l8 -6' stroke='%23e85a7a' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-size: contain;
  }
}

/* 空状态 / 分隔线轻量化 */
.archive-year__head,
.notes-year__label::after {
  border-color: var(--border);
}

/* ==================================================================
   手账标签导航（参考图：左侧站点名 + 右侧标签按钮）
   ================================================================== */
.site-nav__bar {
  width: min(100% - 2.5rem, 63rem);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  pointer-events: auto;
}

.site-nav__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.9rem;
  border: 2px solid var(--ink);
  border-radius: 12px 16px 13px 15px;
  background: var(--surface);
  box-shadow: 2px 3px 0 var(--shadow-sm);
  color: var(--text);
  font-family: var(--font-hand);
  font-size: 1.05rem;
  transform: rotate(-0.8deg);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.site-nav__brand:hover {
  color: var(--text);
  transform: rotate(0deg) translateY(-2px);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

.site-nav__brand-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--brand);
  border: 1.5px solid var(--ink);
}

.site-nav__tags {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.site-nav__tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.42rem 0.95rem;
  border: 1.5px solid var(--ink);
  border-radius: 10px 14px 11px 13px;
  background: var(--surface);
  box-shadow: 2px 3px 0 var(--shadow-sm);
  color: var(--text);
  font-family: var(--font-hand-cn);
  font-size: 0.9rem;
  transform: rotate(-0.6deg);
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.site-nav__tag:nth-child(2n) {
  transform: rotate(0.4deg);
}

.site-nav__tag:hover {
  color: var(--text);
  background: var(--sticky-yellow);
  transform: rotate(0deg) translateY(-2px);
  box-shadow: 3px 4px 0 var(--shadow-sm);
}

.site-nav__tag.is-current,
.site-nav__tag.is-pending {
  background: var(--sticky-yellow);
  transform: rotate(0deg);
}

.site-nav__tag--icon {
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
}

.site-nav__tag--icon svg {
  transition: rotate 0.4s var(--ease-out-soft), scale 0.4s var(--ease-out-soft);
}

.site-nav__tag--icon:hover svg {
  rotate: 10deg;
}

/* 覆盖旧药丸导航，使其不再显示为玻璃 pill */
.site-nav__pill {
  display: none;
}

.site-nav__indicator,
.site-nav__sep {
  display: none;
}

@media (max-width: 700px) {
  .site-nav__bar {
    width: min(100% - 1.5rem, 63rem);
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .site-nav__tags {
    gap: 0.4rem;
  }

  .site-nav__tag {
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
  }
}

@media (max-width: 460px) {
  .site-nav__tags {
    width: 100%;
    justify-content: flex-start;
  }
}

/* ==================================================================
   关于我页面（参考图：左文字卡片 + 右便签堆叠 + 技能圆环）
   ================================================================== */
.about__profile {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 16rem);
  gap: 2.5rem;
  align-items: start;
  margin-bottom: 4rem;
}

.about__intro-card {
  position: relative;
  padding: 1.8rem 2rem;
  background: var(--surface);
  border: 2px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
  box-shadow: 4px 5px 0 var(--shadow-sm);
  transform: rotate(-0.4deg);
}

.about__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.8rem;
  padding: 0.2em 0.7em;
  background: var(--sticky-pink);
  border: 1.5px solid var(--ink);
  border-radius: 0.3em 0.7em 0.35em 0.6em;
  color: var(--ink);
  font-family: var(--font-hand-cn);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  transform: rotate(-1.2deg);
}

.about__eyebrow::before {
  content: "✦";
  color: var(--brand);
  font-size: 0.85em;
}

.about__lead {
  margin: 0 0 1.2rem;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: 0.02em;
}

.about__text {
  margin-top: 0.9rem;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.8;
}

.marker-highlight {
  background: linear-gradient(
    to bottom,
    transparent 55%,
    var(--marker-yellow) 55%,
    var(--marker-yellow) 90%,
    transparent 90%
  );
  padding: 0 0.15em;
  color: var(--text);
}

.about__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.5rem;
}

.about__fact {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border: 1.5px solid var(--ink);
  border-radius: 8px 12px 9px 11px;
  background: var(--surface-muted);
  box-shadow: 1px 2px 0 var(--shadow-sm);
  color: var(--text);
  font-family: var(--font-hand-cn);
  font-size: 0.85rem;
  transform: rotate(-0.5deg);
}

.about__notes {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.5rem;
}

.about__note {
  position: relative;
  padding: 1rem 1.1rem;
  border: 1.5px solid var(--ink);
  border-radius: 12px 16px 13px 15px;
  box-shadow: 2px 3px 0 var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  transform: rotate(-0.8deg);
}

.about__note:nth-child(2) {
  transform: rotate(0.6deg);
}

.about__note:nth-child(3) {
  transform: rotate(-0.4deg);
}

.about__note--yellow {
  background: var(--sticky-yellow);
}

.about__note--cyan {
  background: var(--sticky-cyan);
}

.about__note--pink {
  background: var(--sticky-pink);
}

.about__note-tape {
  position: absolute;
  top: -0.55rem;
  left: 50%;
  transform: translateX(-50%) rotate(-2deg);
  width: 3.5rem;
  height: 1rem;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed rgba(58, 50, 38, 0.25);
}

.about__note strong {
  font-family: var(--font-hand-cn);
  font-size: 1rem;
  font-weight: 400;
}

.about__note span {
  font-size: 0.82rem;
  color: var(--text-muted);
}

/* 技能圆环 */
.about__skills {
  margin-bottom: 4rem;
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: 1.5rem 1rem;
  justify-items: center;
}

.skill-ring {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.skill-ring__track {
  position: relative;
  width: 5.5rem;
  height: 5.5rem;
  border-radius: 50%;
  border: 2.5px solid var(--ink);
  background: var(--surface);
  overflow: hidden;
}

.skill-ring__fill {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(var(--ring-color) var(--percent), transparent 0);
}

.skill-ring__track::before {
  content: "";
  position: absolute;
  inset: 0.5rem;
  border-radius: 50%;
  background: var(--surface);
  z-index: 1;
}

.skill-ring__value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  font-family: var(--font-hand);
  font-size: 1.1rem;
  font-weight: 400;
  color: var(--text);
}

.skill-ring__text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  text-align: center;
}

.skill-ring__text strong {
  font-family: var(--font-hand-cn);
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--text);
}

.skill-ring__text small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .about__profile {
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .about__notes {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }

  .about__note {
    flex: 1 1 8rem;
    max-width: 12rem;
  }
}

@media (max-width: 460px) {
  .about__intro-card {
    padding: 1.4rem 1.25rem;
  }

  .skill-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

`
