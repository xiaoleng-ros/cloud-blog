import { defineConfig } from 'astro/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
// Markdown 插件经 cloud-blog 包名导入（该包 file: 指向仓库根，与 CMS 共用同一份实现）
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeImgAttrs from 'cloud-blog/shared/rehype-img-attrs.mjs';
import rehypeLegacyShortcodes from 'cloud-blog/shared/rehype-legacy-shortcodes.mjs';
import remarkLegacyShortcodes from 'cloud-blog/shared/remark-legacy-shortcodes.mjs';
import { buildMdSanitizeSchema, mdIframeHostGuard } from 'cloud-blog/shared/md-sanitize-schema.mjs';
// Astro 7 的 markdown.processor：astro 自身的可选 peer 依赖，显式声明在 dependencies 里
import { unified } from '@astrojs/markdown-remark';

/**
 * Payload 后台数据 hot-reload：
 * dev 模式下 loader 检测到后台数据变化后会 touch .astro/payload-sync-touch，
 * 这里监听该文件变化并向所有已打开的前台页面广播整页刷新，
 * 实现「后台改任何数据 → 前台自动更新显示」。build / preview 模式不生效。
 */
function payloadHotReload() {
  return {
    name: 'payload-hot-reload',
    hooks: {
      'astro:server:setup'({ server, logger }) {
        // Vite 8 里 server.config.root 是普通字符串（不是 URL 对象），?.pathname 恒 undefined；
        // Windows 下 watcher 回调路径是正斜杠、path.join 产出反斜杠，两侧先归一再比较。
        const rootRaw =
          typeof server.config.root === 'string'
            ? server.config.root
            : fileURLToPath(new URL('./', import.meta.url));
        const toPosix = (p) => String(p).replace(/\\/g, '/');
        const marker = toPosix(path.join(rootRaw, '.astro', 'payload-sync-touch'));

        logger.info('payload-hot-reload: 已启用「后台数据变化 → 前台自动刷新」');
        // loader 首次创建 marker 是 add 事件，只监听 change 会漏掉第一轮刷新
        server.watcher.on('all', (event, file) => {
          if (event !== 'change' && event !== 'add') return;
          const p = typeof file === 'string' ? file : file?.path;
          if (p && toPosix(p) === marker && existsSync(p)) {
            server.ws.send({ type: 'full-reload' });
          }
        });
      },
    },
  };
}

/**
 * SITE_URL 解析（唯一来源）：
 *   astro.config 里用 loadEnv 读取 .env / .env.production，拿到与 feed 端一致的值。
 *   process.env 在配置求值时读不到 .env，所以必须走 loadEnv。
 * 缺失时不给 example.com：dev 打印醒目告警并回退本地地址；build 直接抛错阻断，
 *   避免 example.com 混进 sitemap / RSS / canonical。
 */
// Astro 在加载配置前已按命令设置 NODE_ENV（dev→development，build/preview→production）；
// 未显式为 development 时一律按 production 处理，确保云端 `astro build` 能读到 .env.production。
const MODE = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const LOCAL_ENV = loadEnv(MODE, process.cwd(), '');
const SITE_URL = (LOCAL_ENV.SITE_URL || process.env.SITE_URL || '').trim();
/** 运行时站点根地址：build 保证非空（否则下面集成抛错），dev 兜底本地避免 undefined */
const SITE = SITE_URL || 'http://localhost:4321';

function siteUrlGuard() {
  return {
    name: 'site-url-guard',
    hooks: {
      'astro:config:setup'({ command, logger }) {
        if (SITE_URL) return;
        if (command === 'build') {
          throw new Error(
            '[astro.config] SITE_URL 未设置：build 会拒绝执行，避免占位域名 https://example.com 进入 sitemap / RSS / canonical。' +
              '请在 .env.production 或环境变量中配置真实站点根地址（不要带结尾斜杠）。',
          );
        }
        logger.warn(
          '[astro.config] SITE_URL 未设置，dev 回退 ' + SITE +
            '（仅本地生效，不会污染构建产物）；正式构建必须配置真实域名。',
        );
      },
    },
  };
}

/**
 * 空站守卫：构建产物里一条文章详情页都没有就让构建失败（非零退出）。
 *
 * 为什么放这里而不是 loader 里抛错：loader 在 dev / astro check 里同样会跑，
 * 那两种场景下「后台没起来」是正常状态（dev 靠轮询自愈、check 不关心数据），
 * 只有 build 才需要拦住空站；astro:build:done 只在构建时触发，天然区分。
 * 拦的是两类事故：「库里 0 篇已发布文章」和「PUBLIC_PAYLOAD_URL 指错域名 →
 * 静默回退本地 markdown」，两者都会照常打印 Complete!，随后被 build:all 带上线。
 */
function emptySiteGuard() {
  return {
    name: 'empty-site-guard',
    hooks: {
      'astro:build:done'({ pages }) {
        // pathname 不带前导斜杠（如 404/、posts/AI纪元/2/）；列表页是 posts/ 或 posts，
        // 详情页在 posts/ 之后还有内容
        const detailPages = pages.filter((page) => /^\/?posts\/.+/.test(page.pathname ?? ''));
        if (detailPages.length > 0) return;
        throw new Error(
          '[astro.config] 构建产物里没有任何文章详情页（/posts/*），已中止。' +
            '通常是后台拉取失败后静默回退了本地 markdown（src/content/posts 为空）：' +
            '确认 PUBLIC_PAYLOAD_URL 指向的后台有已发布文章；本地刷新前台外壳请用 npm run sync:blog。',
        );
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  base: '/',
  redirects: {
    '/projects': '/about',
  },
  markdown: {
    // Astro 7 起顶层的 remarkPlugins / rehypePlugins 已废弃，必须挂到 unified() 处理器上；
    // Astro 对旧写法的内部自动接管（validate.js coerceLegacyMarkdownPlugins）与本写法等价。
    processor: unified({
      remarkPlugins: [remarkLegacyShortcodes],
      // 顺序与 CMS blog-render 完全一致：短代码展开 → raw 解析 → 白名单净化 → 图片属性补齐，
      // 保证构建期与运行期(/api/blog-sync)两条链产出相同的净化结果。
      rehypePlugins: [rehypeLegacyShortcodes, rehypeRaw, [rehypeSanitize, buildMdSanitizeSchema(defaultSchema)], mdIframeHostGuard, rehypeImgAttrs],
    }),
  },
  integrations: [payloadHotReload(), siteUrlGuard(), emptySiteGuard()],
  // 把唯一来源的 SITE 注入 import.meta.env.SITE_URL：
  // payload-api.ts / site-defaults.ts（→ rss/sitemap/robots 的 absoluteUrl）全部读同一个值，
  // 彻底消除「astro.config 用 process.env、feed 用 import.meta.env」的双源分歧。
  vite: {
    define: {
      'import.meta.env.SITE_URL': JSON.stringify(SITE),
    },
  },
});

