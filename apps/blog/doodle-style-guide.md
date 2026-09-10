# 手账涂鸦风设计规范

> 适用于 cloud-blog 改造项目，基于参考图「林一的手账」整理。

---

## 一、核心目标

将现有博客改造成一页可翻阅的「数字手账」：

- 整体视觉像打开的笔记本 / 拼贴手账。
- 用便签、贴纸、手绘箭头、荧光笔高亮传递信息。
- 保留原有内容结构，只替换视觉层。

---

## 二、CSS 变量规范

```css
:root {
  /* 背景与纸张 */
  --bg: #f6efdd;                 /* 米黄色笔记本纸 */
  --surface: #fffdf6;            /* 白色便签/卡片 */
  --surface-elevated: #ffffff;   /* 顶层浮起卡片 */

  /* 文字 */
  --text: #3a3226;               /* 深褐墨水色 */
  --text-muted: #7a6f5d;         /* 次要说明文字 */
  --text-inverse: #fffdf6;       /* 深色背景上的文字 */

  /* 品牌与强调 */
  --brand: #e0603a;              /* 番茄红，用于重点按钮或高亮 */
  --brand-soft: #f4a58a;         /* 浅番茄色 */

  /* 便签荧光色 */
  --sticky-yellow: #ffdf8a;      /* 柠檬黄便签 */
  --sticky-cyan: #a6e6de;        /* 薄荷绿便签 */
  --sticky-pink: #ffb7c9;        /* 婴儿粉便签 */
  --sticky-green: #c9e6a4;       /* 浅绿便签 */
  --sticky-purple: #d8c4f7;      /* 淡紫便签（扩展） */

  /* 荧光笔高亮 */
  --marker-yellow: #fff176;      /* 黄色荧光笔底色 */
  --marker-green: #b9f6ca;       /* 绿色荧光笔底色 */
  --marker-pink: #ff80ab;        /* 粉色荧光笔底色 */

  /* 描边与墨水 */
  --ink: #3a3226;                /* 手绘描边主色 */
  --ink-light: rgba(58, 50, 38, 0.35);  /* 弱化描边 */

  /* 阴影 */
  --shadow-sm: 2px 3px 0 rgba(58, 50, 38, 0.12);
  --shadow-md: 3px 4px 0 rgba(58, 50, 38, 0.16);
  --shadow-lg: 5px 6px 0 rgba(58, 50, 38, 0.18);

  /* 纸张纹理 */
  --paper-line: rgba(154, 130, 90, 0.18);   /* 横线颜色 */
  --paper-dot: rgba(154, 130, 90, 0.22);     /* 点阵颜色 */

  /* 字体 */
  --font-hand: "Ma Shan Zheng", "ZCOOL KuaiLe", "KaiTi", "STKaiti", cursive;
  --font-hand-bold: "ZCOOL KuaiLe", "Ma Shan Zheng", "KaiTi", cursive;
  --font-body: "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", "Fira Code", monospace;

  /* 圆角 */
  --radius-doodle: 255px 15px 225px 15px / 15px 225px 15px 255px;
  --radius-doodle-sm: 120px 10px 110px 10px / 10px 110px 10px 120px;
  --radius-sticker: 18px 22px 16px 24px;

  /* 间距 */
  --space-xs: 0.5rem;   /* 8px */
  --space-sm: 0.75rem;  /* 12px */
  --space-md: 1rem;     /* 16px */
  --space-lg: 1.5rem;   /* 24px */
  --space-xl: 2.5rem;   /* 40px */
  --space-2xl: 4rem;    /* 64px */

  /* 旋转角度 */
  --tilt-sm: -1deg;
  --tilt-md: -2deg;
  --tilt-lg: -3deg;
}
```

---

## 三、全局效果

### 3.1 页面背景

```css
/* 稿纸横线 */
body {
  background-color: var(--bg);
  background-image: linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(1.95rem - 1px),
    var(--paper-line) calc(1.95rem - 1px),
    var(--paper-line) 1.95rem
  );
  background-attachment: fixed;
  background-size: 100% 1.95rem;
  color: var(--text);
  font-family: var(--font-body);
}
```

### 3.2 不规则圆角

```css
.doodle-radius {
  border-radius: var(--radius-doodle);
}
```

### 3.3 硬偏移投影

```css
.doodle-shadow {
  box-shadow: var(--shadow-md);
}
```

### 3.4 手绘描边

```css
.doodle-border {
  border: 1.5px solid var(--ink);
}
```

---

## 四、组件清单

### 4.1 导航标签（Tag Navigation）

**用途：** 顶部页面切换。

**视觉特征：**

- 胶囊/矩形小按钮
- 黑色或深色细描边
- 当前激活项用荧光色填充
- 微微倾斜或不规则圆角

**类名建议：**

```css
.nav-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.45em 1em;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sticker);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--text);
  transform: rotate(var(--tilt-sm));
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.nav-tag:hover {
  transform: rotate(0deg) translateY(-2px);
  box-shadow: var(--shadow-md);
}

.nav-tag.is-active {
  background: var(--sticky-yellow);
  transform: rotate(0deg);
}
```

---

### 4.2 Hero 名片卡片

**用途：** 首页首屏自我介绍。

**视觉特征：**

- 白色不规则圆角大卡片
- 标题用手写体
- 名字中的关键字用彩色（如粉色）突出
- 卡片上有手绘箭头、黄色圆点贴纸装饰
- 轻微倾斜

**类名建议：**

```css
.hero-card {
  position: relative;
  max-width: 42rem;
  margin: 0 auto;
  padding: var(--space-xl);
  background: var(--surface);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-doodle);
  box-shadow: var(--shadow-md);
  transform: rotate(var(--tilt-sm));
}

.hero-card__title {
  font-family: var(--font-hand);
  font-size: clamp(2rem, 6vw, 3.5rem);
  text-align: center;
  line-height: 1.2;
}

.hero-card__title .accent {
  color: var(--brand);
}

.hero-card__subtitle {
  text-align: center;
  color: var(--text-muted);
  margin-top: var(--space-sm);
}

.hero-card__arrow {
  position: absolute;
  top: 10%;
  left: 8%;
  width: 2.5rem;
  height: 2.5rem;
  background: url("data:image/svg+xml,...") no-repeat center / contain;
}

.hero-card__dot {
  position: absolute;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--sticky-yellow);
  bottom: 15%;
  left: 12%;
}
```

---

### 4.3 便签卡片（Sticky Note）

**用途：** 侧边信息、小标签、快速提示。

**视觉特征：**

- 矩形或圆角矩形
- 荧光黄 / 薄荷绿 / 婴儿粉背景
- 顶部或一角有轻微卷起（用伪元素模拟）
- 可用胶带痕迹固定

**类名建议：**

```css
.sticky-note {
  position: relative;
  padding: var(--space-md);
  background: var(--sticky-yellow);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sticker);
  box-shadow: var(--shadow-sm);
  transform: rotate(var(--tilt-sm));
}

.sticky-note--cyan { background: var(--sticky-cyan); }
.sticky-note--pink { background: var(--sticky-pink); }
.sticky-note--green { background: var(--sticky-green); }

/* 胶带 */
.sticky-note::before {
  content: "";
  position: absolute;
  top: -0.6rem;
  left: 50%;
  transform: translateX(-50%) rotate(-2deg);
  width: 4rem;
  height: 1.2rem;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed rgba(58, 50, 38, 0.25);
}
```

---

### 4.4 关于我区域

**用途：** 个人简介与基本信息。

**视觉特征：**

- 左右分栏：左侧文字，右侧便签堆叠
- 标题左侧有装饰小标签（如 ABOUT / 关于我）
- 标题下方有虚线分隔
- 文字中关键词用荧光笔高亮

**类名建议：**

```css
.about-section {
  display: grid;
  grid-template-columns: 1fr 16rem;
  gap: var(--space-xl);
  align-items: start;
}

.about-section__title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-hand);
  font-size: 1.5rem;
  margin-bottom: var(--space-md);
}

.about-section__title::after {
  content: "";
  flex: 1;
  height: 1px;
  border-bottom: 2px dashed var(--ink-light);
}

.about-section__text .marker {
  background: var(--marker-yellow);
  padding: 0 0.2em;
  border-radius: 4px;
}

.about-notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
```

---

### 4.5 技能圆环（Doodle Progress Ring）

**用途：** 展示技能熟练度。

**视觉特征：**

- 手绘风格圆环
- 不同技能用不同颜色
- 中心显示百分比
- 下方有技能名称和小字说明

**类名建议：**

```css
.skill-ring {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
}

.skill-ring__circle {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  border: 3px solid var(--ink);
  background: conic-gradient(var(--ring-color) var(--percent), transparent 0);
  position: relative;
}

.skill-ring__circle::before {
  content: "";
  position: absolute;
  inset: 0.45rem;
  border-radius: 50%;
  background: var(--surface);
}

.skill-ring__value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-hand-bold);
  font-size: 1.1rem;
}

.skill-ring__label {
  font-size: 0.85rem;
  text-align: center;
}
```

---

### 4.6 荧光笔高亮

**用途：** 强调段落中的关键词。

```css
.marker-highlight {
  background: linear-gradient(
    to bottom,
    transparent 55%,
    var(--marker-yellow) 55%,
    var(--marker-yellow) 90%,
    transparent 90%
  );
  padding: 0 0.15em;
}

.marker-highlight--green {
  --marker-yellow: var(--marker-green);
}

.marker-highlight--pink {
  --marker-yellow: var(--marker-pink);
}
```

---

### 4.7 手绘分隔线

```css
.divider-dashed {
  border: none;
  height: 2px;
  background: repeating-linear-gradient(
    to right,
    var(--ink-light) 0,
    var(--ink-light) 8px,
    transparent 8px,
    transparent 14px
  );
}
```

---

### 4.8 圆点贴纸

```css
.dot-sticker {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: var(--sticky-yellow);
  border: 1.5px solid var(--ink);
  box-shadow: var(--shadow-sm);
}
```

---

## 五、字体加载

在 `BaseLayout.astro` 的 `<head>` 中引入：

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=ZCOOL+KuaiLe&display=swap"
/>
```

---

## 六、常用类名速查

| 类名 | 作用 |
|---|---|
| `.doodle-radius` | 不规则手绘圆角 |
| `.doodle-border` | 深色手绘描边 |
| `.doodle-shadow` | 硬偏移投影 |
| `.sticky-note` | 荧光便签卡片 |
| `.nav-tag` | 导航标签按钮 |
| `.hero-card` | 首屏名片 |
| `.marker-highlight` | 荧光笔高亮文字 |
| `.divider-dashed` | 虚线分隔线 |
| `.dot-sticker` | 圆点贴纸装饰 |
| `.skill-ring` | 手绘圆环进度 |

---

## 七、改造 checklist

- [ ] 在 `global.css` 中覆盖 `:root` 变量。
- [ ] 给 `body` 添加稿纸横线背景。
- [ ] 将导航改为 `.nav-tag` 标签样式。
- [ ] 将首页 Hero 改为 `.hero-card`。
- [ ] 将文章列表卡片加上 `.doodle-border` + `.doodle-shadow`。
- [ ] 将「关于我」改为左右分栏 + 便签堆叠。
- [ ] 将技能/标签改为圆环或贴纸样式。
- [ ] 所有按钮统一为手绘描边风格。
- [ ] 检查移动端适配，避免倾斜元素遮挡文字。
