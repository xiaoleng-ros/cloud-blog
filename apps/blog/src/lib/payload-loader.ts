/**
 * Payload 数据加载器（Astro 自定义 Loader）
 *
 * 数据流通：构建/开发时优先从后台 API 拉取文章与随笔；
 * 后台不可用（API 失败）时自动回退到本地 src/content 下的 .md 文件，
 * 保证前台在后台未启动时仍可正常开发与构建。
 *
 * 渲染：统一使用 LoaderContext.renderMarkdown()，与前台 glob loader 的
 * markdown 管线完全一致（astro.config 中的 remark/rehype 插件均生效）。
 *
 * dev 自动同步：Loader 只在 dev 启动时执行一次，后台数据改动不会自动反映。
 * 因此 dev 模式下会每 AUTO_REFRESH_MS 轮询一次后台 API（文章/随笔/站点设置），
 * 检测到任何变化时更新数据仓库，并通过 touch .astro/payload-sync-touch 通知
 * astro.config 中的 payload-hot-reload 集成，让已打开的前台页面自动刷新。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import type { Loader, LoaderContext, DataStore } from 'astro/loaders';
import { fetchNavItems, fetchNotes, fetchPosts, fetchSiteSettings, type MdEntry } from './payload-api';

/** dev 自动同步轮询间隔（毫秒）：3s，接近实时 */
const AUTO_REFRESH_MS = 3_000
/** 与 astro.config.mjs 约定的刷新信号文件 */
const SYNC_MARKER = path.join(process.cwd(), '.astro', 'payload-sync-touch')
/** meta 中保存各数据源摘要的 key，用于判断内容是否变化 */
const DIGEST_KEYS = {
  posts: 'digest-posts',
  notes: 'digest-notes',
  settings: 'digest-settings',
  nav: 'digest-nav',
} as const

/** 递归收集目录下所有 .md 文件，返回 [id(相对路径去扩展名), 绝对路径] */
function collectLocalMarkdown(dir: string): Array<{ id: string; file: string }> {
  if (!existsSync(dir)) return [];
  const results: Array<{ id: string; file: string }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectLocalMarkdown(full));
    } else if (entry.name.endsWith('.md')) {
      const id = path
        .relative(dir, full)
        .replace(/\\/g, '/')
        .replace(/\.md$/, '');
      results.push({ id, file: full });
    }
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/** 把本地 markdown 文件解析成与 API 相同结构的条目 */
function localEntries(files: Array<{ id: string; file: string }>): MdEntry[] {
  return files.map(({ id, file }) => {
    const { data, content } = matter(readFileSync(file, 'utf-8'));
    return { id, data, body: content };
  });
}

/**
 * 将条目写入数据仓库并渲染 markdown
 * @param ctx     loader 上下文
 * @param store   数据仓库（posts 与 notes 各用各的）
 * @param entries 条目列表（id + data + body）
 */
async function storeEntries(
  ctx: LoaderContext,
  store: DataStore,
  entries: MdEntry[],
  fileOf?: (id: string) => string,
) {
  for (const entry of entries) {
    // 用前台 collection schema 校验/清洗数据
    const data = await ctx.parseData({ id: entry.id, data: entry.data });

    // 传 fileURL 以便 markdown 内相对图片路径解析
    const file = fileOf?.(entry.id);
    const fileURL = file ? pathToFileURL(file) : undefined;

    try {
      const rendered = await ctx.renderMarkdown(entry.body, fileURL ? { fileURL } : undefined);
      store.set({ id: entry.id, data, body: entry.body, rendered });
    } catch (error) {
      // 个别条目渲染失败不阻塞整体，仅告警并保留原始 body
      ctx.logger.warn(`[payload-loader] 渲染失败 ${entry.id}: ${(error as Error).message}`);
      store.set({ id: entry.id, data, body: entry.body });
    }
  }
}

/** 文章加载器：API 优先，本地 markdown 兜底 */
export const payloadPostsLoader: Loader = {
  name: 'payload-posts-loader',
  async load(ctx) {
    const localBase = path.join(process.cwd(), 'src/content/posts');
    const urlsOf = new Map<string, string>();

    try {
      const entries = await fetchPosts();
      ctx.logger.info(`[payload-loader] 文章：从后台 API 载入 ${entries.length} 条`);
      await storeEntries(ctx, ctx.store, entries);
      ctx.meta.set(DIGEST_KEYS.posts, ctx.generateDigest(JSON.stringify(entries)));
    } catch (error) {
      // 后台不可用 → 回退本地 markdown
      const files = collectLocalMarkdown(localBase);
      files.forEach(({ id, file }) => urlsOf.set(id, file));
      const entries = localEntries(files);
      ctx.logger.warn(
        `[payload-loader] 后台不可用（${(error as Error).message}），回退本地 markdown：${entries.length} 篇`,
      );
      await storeEntries(ctx, ctx.store, entries, (id) => urlsOf.get(id));
    }

    // 无论初始加载是否成功都启用轮询：
    // 若启动时后台正好不可用，等后台恢复后下一轮轮询会自动切回 API 数据并触发前台刷新
    schedulePolling(ctx, '文章/站点设置', pollPostsAndSettings);
  },
};

/** 随笔加载器：API 优先，本地 markdown 兜底 */
export const payloadNotesLoader: Loader = {
  name: 'payload-notes-loader',
  async load(ctx) {
    const localBase = path.join(process.cwd(), 'src/content/notes');
    const urlsOf = new Map<string, string>();

    try {
      const entries = await fetchNotes();
      ctx.logger.info(`[payload-loader] 随笔：从后台 API 载入 ${entries.length} 条`);
      await storeEntries(ctx, ctx.store, entries);
      ctx.meta.set(DIGEST_KEYS.notes, ctx.generateDigest(JSON.stringify(entries)));
    } catch (error) {
      // 后台不可用 → 回退本地 markdown
      const files = collectLocalMarkdown(localBase);
      files.forEach(({ id, file }) => urlsOf.set(id, file));
      const entries = localEntries(files);
      ctx.logger.warn(
        `[payload-loader] 后台不可用（${(error as Error).message}），回退本地 markdown：${entries.length} 条`,
      );
      await storeEntries(ctx, ctx.store, entries, (id) => urlsOf.get(id));
    }

    // 无论初始加载是否成功都启用轮询（理由同上：后台恢复后自动切回 API 数据）
    schedulePolling(ctx, '随笔', pollNotes);
  },
};

/** touch 刷新信号文件，通知 dev 集成广播浏览器整页刷新 */
function touchSyncMarker() {
  try {
    writeFileSync(SYNC_MARKER, String(Date.now()));
  } catch {
    // 忽略写失败（仅在 dev 模式下需要）
  }
}

/**
 * dev 自动同步：
 * 每 AUTO_REFRESH_MS 轮询指定数据源，摘要变化 → 更新数据仓库并
 * touch 信号文件触发页面刷新。build / 预览（无 watcher）不启用。
 */
function schedulePolling(
  ctx: LoaderContext,
  label: string,
  pollSource: (ctx: LoaderContext) => Promise<boolean>,
) {
  if (!ctx.watcher) return;

  ctx.logger.info(`[payload-loader] 已启用 dev 自动同步（每 ${AUTO_REFRESH_MS / 1000}s 轮询 ${label}）`);

  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const changed = await pollSource(ctx);
      if (changed) {
        ctx.logger.info(`[payload-loader] ${label}：后台数据有变化，已自动同步`);
        touchSyncMarker();
      }
    } catch (error) {
      // 后台暂时不可用：保持现有数据，等待下一轮
      ctx.logger.warn(`[payload-loader] ${label}：自动同步失败（${(error as Error).message}）`);
    } finally {
      running = false;
    }
  };

  setInterval(() => void poll(), AUTO_REFRESH_MS);
}

/** 轮询文章 + 站点设置 + 导航：有任何变化时更新/记录，返回是否变化 */
async function pollPostsAndSettings(ctx: LoaderContext): Promise<boolean> {
  let changed = false;

  const entries = await fetchPosts();
  const postsDigest = ctx.generateDigest(JSON.stringify(entries));
  if (ctx.meta.get(DIGEST_KEYS.posts) !== postsDigest) {
    ctx.meta.set(DIGEST_KEYS.posts, postsDigest);
    await storeEntries(ctx, ctx.store, entries);
    changed = true;
  }

  const data = await fetchSiteSettings();
  const settingsDigest = ctx.generateDigest(JSON.stringify(data ?? null));
  if (ctx.meta.get(DIGEST_KEYS.settings) !== settingsDigest) {
    ctx.meta.set(DIGEST_KEYS.settings, settingsDigest);
    changed = true;
  }

  const navItems = await fetchNavItems();
  const navDigest = ctx.generateDigest(JSON.stringify(navItems ?? null));
  if (ctx.meta.get(DIGEST_KEYS.nav) !== navDigest) {
    ctx.meta.set(DIGEST_KEYS.nav, navDigest);
    changed = true;
  }

  return changed;
}

/** 轮询随笔：有变化时更新 store，返回是否变化 */
async function pollNotes(ctx: LoaderContext): Promise<boolean> {
  const entries = await fetchNotes();
  const digest = ctx.generateDigest(JSON.stringify(entries));
  if (ctx.meta.get(DIGEST_KEYS.notes) === digest) return false;
  ctx.meta.set(DIGEST_KEYS.notes, digest);
  await storeEntries(ctx, ctx.store, entries);
  return true;
}