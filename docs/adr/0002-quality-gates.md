# 0002 · 质量门禁：CI 只跑「能做确定判断」的检查

- **状态**：已采纳
- **日期**：2026-11-13
- **影响范围**：`.github/workflows/ci.yml`、根 `package.json`、`scripts/run-prettier.mjs`

## 背景

仓库此前**没有任何自动化检查**。两道门禁（`npm run typecheck`、`verify-html-inject.mjs`）
都已写好，但只存在于 README 的说明里，靠人记得手动执行。实际后果是：

- `verify-html-inject.mjs` 的 53 条断言从未在提交时跑过，它保护的正是
  「标签墙整块变裸文本」这类线上事故的回归；
- 格式全凭习惯，同一种风格在不同文件里漂移；
- 改坏类型只会在部署时由 EdgeOne 构建失败暴露，反馈周期以分钟计。

## 决策

新建 `.github/workflows/ci.yml`，在 push / PR 到 `main` 时跑**四步**：
两处 `typecheck`、`verify-html-inject.mjs`、`fmt:check`。

**不在 CI 里跑 `build:all`。**

## 关键取舍

### 为什么 CI 不跑完整构建

`build:all` 的第一步是 `astro build`，而 Astro 在**构建期**就要 fetch
`PUBLIC_PAYLOAD_URL` 拉取全量内容（`apps/blog/src/lib/payload-loader.ts`）。CI 里没有
线上库的凭证，跑起来只会得到「模板默认文案 + 0 篇文章」的兜底产物，
**它既不能证明构建可修复，也不能证明页面正确**，却要多花几分钟装依赖 + 构建。

完整构建的正确位置是 EdgeOne 的 `buildCommand`（`apps/cms/edgeone.json`），
那里有真实凭证，且 `verify-html-inject.mjs` 也已接进同一条命令——**同一份断言两处复用**，
CI 负责快速反馈，部署负责最后一道闸。

### 为什么 CI 必须 `npm ci` 三次

仓库**不是** npm workspace：`apps/blog` 与 `apps/cms` 各自带 `package.json` 与 lockfile，
根目录原本没有依赖。现在根目录装了 Prettier（`fmt:check` 需要），所以是三次：

```yaml
npm ci                      # 根：prettier
npm ci --prefix apps/blog   # astro + patch-package
npm ci --prefix apps/cms    # next + payload
```

**不能加 `--ignore-scripts`**：`apps/blog` 的 `postinstall` 要跑 `patch-package`
打上 `patches/astro+7.4.0.patch`（修中文路径编码问题），跳过就等于在未打补丁的
Astro 上跑类型检查，结果不可信。

### 为什么格式检查单独写一个脚本

`prettier --check .` 直接可用，但有两个问题：

1. Windows 下可执行位是 `prettier.cmd`，跨平台调用要分叉；
2. 需要「只检查本轮改动的文件」（`--changed`），Prettier CLI 不支持。

`scripts/run-prettier.mjs` 用 `prettier.getFileInfo()` 做过滤，这一处同时解决了两件事：
尊重 `.prettierignore`，以及**自动跳过 `.astro`**——本仓库没装 `prettier-plugin-astro`，
Prettier 对 `.astro` 推断不出 parser（返回 `null`），跳过是唯一不会报错的行为。
`apps/blog` 里 43 个 `.astro` 文件因此完全不参与格式化，风格继续由人工维护。

## 后果

- 一次 CI 运行约 3–5 分钟，覆盖类型、注入行为、格式三类回归。
- 格式成为硬门禁后，任何人提交前跑 `npm run fmt` 即可；`npm run fmt:changed`
  只处理 git 里改动过的文件，适合改完一处就顺手对齐。
- **代价**：格式化首次引入时产生了约 3300 行真实 diff（无分号 + printWidth 120 +
  行尾归一）。这类 diff 会污染 `git blame` 一次，之后归零。

## 补充：为什么 `semi: false` 与 `printWidth: 120`

不是审美选择，是**跟随既有主流以减少 diff**。实测 `apps/cms/src` 35356 行中
只有 9.6% 的行尾带分号；printWidth 试了 100 / 120 / 140，120 的改动面最小
（83 文件 / 约 4305 行），140 反而更大（88 文件 / 4838 行）。
`endOfLine: "auto"` 同理：仓库 blob 是 LF、工作区因 `core.autocrlf=true` 是 CRLF，
写死任一侧都会制造整个工作区的假 diff。
