# 03 · 页面 / 模块 / 字段 / 模型 映射表

> 六列：前台位置 → 模块 → 展示字段 → 数据来源（现） → 后台维护入口 → 备注。
> 「后台维护入口」即内容编辑在 Payload 中的位置；标注「派生」的字段由前台代码计算，不需后台维护（方案原则：内容与样式分离）。

## 1. 全局布局（全站生效）

| 前台位置 | 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `components/Nav.astro` | 品牌名 | `siteName` | `site-settings.siteName` | 站点设置 → 站点信息 | 必填；后台不可用回退 `SITE_DEFAULTS.siteName` |
| `components/Nav.astro` | 顶栏导航 | 每行「标签 链接」 | `navigation.navItems` | 导航管理 | 空则回退默认四项（首页/随笔/归档/关于） |
| `components/Nav.astro:29-33` | 「更多」面板 | `/stats/`、`/tags/`、GitHub | 站内路由为结构常量；GitHub 取 `site-settings.socials` 中 icon=github 的链接 | 社交链接 | 有意不进后台（固定路由非业务数据） |
| `components/Footer.astro` | 页脚副标题/频道/群组 | `footerSubtitle/footerChannels/footerGroups` | `site-settings` | 站点设置 → 页脚 | 行格式「名称 链接」，图标走 `shared/site-defaults` 别名表 |
| `components/Footer.astro` | ICP 备案号 | `siteIcp` | `site-settings.siteIcp` | 站点设置 → 网站配置 | 填了才显示 |
| `layouts/BaseLayout.astro` | SEO（title/description/OG/canonical） | 页面级 | 各集合字段 + `SITE_URL` 构建变量 | 各集合字段 | OG 无封面时用默认图（视觉兜底） |

## 2. 首页 `/`（`pages/index.astro`）

| 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| Hero 卡 | greeting/name/subtitle/bio/buttonLabel | `site-settings` Hero 分组 | 站点设置 → 首页 Hero | bio 中 `{count}` 由前台替换为文章总数 |
| Hero 卡 | 社交图标 | `site-settings.socials`（行「平台 链接」） | 站点设置 → 社交链接 | 平台名→图标走图标别名表 |
| 精选列表 `heroPicks` | title/date/cover/categories/tags | `posts` 集合 | 文章管理 | 取 sticky 优先 + 最新，最多 5 条（派生规则） |
| 最新文章 `latestPosts` + 计数 `heroCount` | title/date/cover/coverAlt/description/categories/tags/ai | `posts` 集合 | 文章管理 | 「全部 N 篇」= 已发布数（派生） |
| 侧栏站点运行时间 `SiteAge` | 起始日 → 天数/年月日 | `site-settings.siteCreatedAt`（**本次接线**） | 站点设置 → 网站配置 → 网站创建时间 | 填了才显示；留空整块不渲染；后台不可用回退 `PLACEHOLDER_SITE_SINCE`；客户端进页用同一算法按当前时刻重算 |

## 3. 文章详情 `/posts/{分类}/{id}/`（`pages/posts/[...slug].astro`）

| 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| 文章头 | title/date(createdAt)/cover/coverAlt/categories/tags/keywords/author | `posts` 集合 | 文章管理 | date 缺失回退 createdAt |
| 正文 | Markdown 渲染（净化 + shiki + 图片 alt 注入） | `posts.content` + `media.alt` | 文章管理 / 媒体库 | 短代码经 shared 插件解析 |
| SEO 描述 | `description ?? ai[0]` | `posts` 集合 | 文章管理 | 派生回退链 |
| 目录 `tocSidebar` | 标题目录 | 正文派生 | — | 纯前台计算 |
| 相邻/相关 `articleFooter` | 上/下篇、相关 | `posts` 集合派生 | — | 排序与匹配规则在 `shared/post-utils` |
| 阅读时长 | 分钟数 | 正文派生 | — | — |
| JSON-LD | headline/author/date… | 集合字段 + `siteAuthor` | 文章管理 / 站点设置 | 作者回退 `SITE_DEFAULTS.author`（站点级） |
| 评论区 `CommentsBox` | 评论列表/表单 | Waline（进程内） | 后台评论管理页 | 仅文章页；`path` 存解码原形 |

## 4. 随笔 `/notes/`（`pages/notes.astro`）

| 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| 随笔流 | date/title/mood/tags/body | `notes` 集合 | 随笔管理 | mood→图标为前台 UI 映射表 |
| 时间索引 `notesAside` | 年/月锚点 | 派生（`Asia/Shanghai` 定格） | — | 锚点 id 生成与搜索索引共用同一实现 |
| 评论区 | 同上 | Waline | 后台评论管理页 | — |

## 5. 归档与词条页

| 页面 | 模块 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| `/archive/`、`/archive/{n}/` | 归档头/统计/按年列表/分页 | `posts` 派生（`shared/post-utils` 每页 5 篇） | 文章管理 | 分类/标签计数派生 |
| `/categories/{c}/`、`/tags/{t}/` | 词条切换/计数/文章列表 | `posts` 派生（`shared/site-stats`） | 分类管理 / 标签管理（经文章关系） | — |
| `/tags/` | 标签墙 | `posts` 派生 | 标签管理 | — |

## 6. 统计 `/stats/`（`pages/stats.astro`）

| 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| 统计卡 | 文章数/随笔数/分类数/标签数/阅读时长 | `posts`+`notes` 派生（`buildSiteStats`） | — | — |
| 分类环形图 | 占比 | 派生 | — | 配色为 UI 常量 |
| 年份分布 | 年度计数 | 派生 | — | — |
| 运行天数行 | 「站点已运行 N 天（y 年 m 月 d 天）」 | `site-settings.siteCreatedAt`（**本次接线**） | 站点设置 → 网站配置 | 填了才显示；留空整行消失 |

## 7. 关于页 `/about/`（`pages/about.astro`）

| 模块 | 展示字段 | 数据来源 | 后台维护入口 | 备注 |
| --- | --- | --- | --- | --- |
| 个人便签 | lead/paragraphs/notes/skills | `site-settings` about 分组 | 站点设置 → 关于页 | `==高亮==` 记号经 `shared/about-format` 解析 |
| 技能环 | label/sublabel/value/color | 同上 | 同上 | — |
| 项目卡片 | group/groupDescription/title/owner/description/icon/href/articleHref/stars/tags/sortOrder | `projects` 集合 | 项目管理 | 分组锚点 id 与搜索索引共用同一实现 |
| 页脚统计 | 文章总数/最早年份 | 派生 | — | — |

## 8. 派生输出（无需后台维护）

| 产物 | 文件 | 来源 |
| --- | --- | --- |
| `/rss.xml` | `rss.xml.ts` | posts 最新 50 篇 + `site-settings` |
| `/sitemap.xml` | `sitemap.xml.ts` | 全路由 + 各集合 |
| `/site-index.json` | `site-index.json.ts` → `lib/site-index.ts` | 全站索引（搜索用） |
| `/search/` | 客户端 `lib/search-match.ts` | 读上述索引 |
| `/robots.txt` | `robots.txt.ts` | 静态规则 |

## 9. 常量与兜底登记（有意保留）

| 类别 | 位置 | 理由 |
| --- | --- | --- |
| 离线兜底（Hero/社交/页脚/关于/ICP/起始日） | `shared/site-defaults.ts` | 仅 `settings === null` 时生效 |
| 站点名/描述/作者兜底 | `apps/blog/src/lib/site-defaults.ts` | 后台不可用时兜底 |
| mood→图标、标签/分类配色、默认封面/OG | 前台组件内 | 纯 UI 映射 |
| 音乐 API 与歌单兜底 | `MusicPlayer.astro` | 第三方服务兜底，歌单 ID 已接后台 |
| 项目图标默认 `github` | shared 常量（**本次收敛**） | 三处共用单一来源 |
