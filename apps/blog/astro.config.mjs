import { defineConfig } from 'astro/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import rehypeImgAttrs from './src/lib/rehype-img-attrs.mjs';
import rehypeLegacyShortcodes from './src/lib/rehype-legacy-shortcodes.mjs';
import remarkLegacyShortcodes from './src/lib/remark-legacy-shortcodes.mjs';

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
        const root = server.config.root?.pathname ?? fileURLToPath(new URL('./', import.meta.url));
        const marker = path.join(root, '.astro', 'payload-sync-touch');

        logger.info('payload-hot-reload: 已启用「后台数据变化 → 前台自动刷新」');
        server.watcher.on('change', (file) => {
          const p = typeof file === 'string' ? file : file?.path;
          if (p && p === marker && existsSync(p)) {
            server.ws.send({ type: 'full-reload' });
          }
        });
      },
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://example.com',
  redirects: {
    '/projects': '/about',
  },
  markdown: {
    remarkPlugins: [remarkLegacyShortcodes],
    rehypePlugins: [rehypeLegacyShortcodes, rehypeImgAttrs],
  },
  integrations: [payloadHotReload()],
});
