/**
 * Payload 数据加载器（Astro 自定义 Loader）
 *
 * 数据流通：构建/开发时优先从后台 API 拉取文章与随笔；
 * 后台不可用（API 失败）时自动回退到本地 src/content 下的 .md 文件，
 * 保证前台在后台未启动时仍可开发。构建不允许产出空站：文章详情页一条都没有时
 * 由 astro.config 的 empty-site-guard 集成让构建非零退出（「0 篇文章」的产物
 * 会照常打印 Complete!，发现不了，还可能被 build:all 带上线）。
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
import { PAYLOAD_URL, fetchMediaAltMap, fetchNavItems, fetchNotes, fetchPosts, fetchProjects, fetchSiteSettings, fetchSyncDigest, type MdEntry } from './payload-api';
import { setAltMap } from 'cloud-blog/shared/rehype-img-attrs.mjs';

/**
 * dev 自动同步轮询间隔（毫秒）：3s，接近实时。
 *
 * 每轮只发一次「指纹探测」（/api/blog-sync?digest=1，<1KB，命中后台快照缓存时零查库、不渲染区块），
 * 只有真正变化了的那一路数据才会去重拉全量正文。以前每 3s 要把 6 路 limit=0 全量正文
 * 跨公网拖一遍，现在改成 3s 也不会再和「手动刷新页面」抢后台连接池。
 * 想更省资源可设 PAYLOAD_POLL_MS=15000。
 */
const AUTO_REFRESH_MS = (() => {
  const raw = Number(process.env.PAYLOAD_POLL_MS)
  return Number.isFinite(raw) && raw >= 1_000 ? raw : 3_000
})()
/** 与 astro.config.mjs 约定的刷新信号文件 */
const SYNC_MARKER = path.join(process.cwd(), '.astro', 'payload-sync-touch')
/** meta 中保存各数据源摘要的 key，用于判断内容是否变化 */
const DIGEST_KEYS = {
  posts: 'digest-posts',
  notes: 'digest-notes',
  settings: 'digest-settings',
  nav: 'digest-nav',
  projects: 'digest-projects',
  mediaAlt: 'digest-media-alt',
} as const

/** meta 中保存「后台指纹」的 key。与 digest-* 分开存：前者是 <1KB 的探测结果，后者是全量正文摘要 */
const STAMP_KEYS = {
  posts: 'stamp-posts',
  notes: 'stamp-notes',
  settings: 'stamp-settings',
  nav: 'stamp-nav',
  projects: 'stamp-projects',
  media: 'stamp-media',
} as const
type StampSource = keyof typeof STAMP_KEYS

/**
 * 指纹探测的模块级去重：posts / notes / projects 三个 loader 各挂一个 setInterval，
 * 同一时间窗里会撞出 3 次探测请求；探测在途时无条件复用同一 Promise，
 * 且结果在 AUTO_REFRESH_MS（与轮询节奏对齐）内视为新鲜直接复用。
 * 连续 PROBE_FAILURE_LIMIT 次失败进入退避：暂停所有轮询 PROBE_BACKOFF_MS，
 * 避免探测超时（8s）≫ 轮询间隔（3s）时 fail-open 退化成每 3s 全量重拉；成功一次即恢复。
 */
const PROBE_FAILURE_LIMIT = 3
const PROBE_BACKOFF_MS = 15_000
let digestPromise: Promise<Record<string, string> | null> | null = null
let digestResult: { value: Record<string, string> | null; at: number } | null = null
let probeFailures = 0
let probeBackoffUntil = 0

function probeDigests(): Promise<Record<string, string> | null> {
  const now = Date.now();
  // 在途：无条件复用（探测超时可达 8s，TTL 比超时短就合并不了并发）
  if (digestPromise) return digestPromise;
  if (digestResult && now - digestResult.at < AUTO_REFRESH_MS) return Promise.resolve(digestResult.value);
  if (now < probeBackoffUntil) return Promise.resolve(digestResult?.value ?? null);
  digestPromise = fetchSyncDigest()
    .then((res) => res?.digests ?? null)
    .catch(() => null)
    .then((value) => {
      if (value) {
        probeFailures = 0;
        probeBackoffUntil = 0;
        digestResult = { value, at: Date.now() };
      } else {
        probeFailures += 1;
        if (probeFailures >= PROBE_FAILURE_LIMIT) probeBackoffUntil = Date.now() + PROBE_BACKOFF_MS;
      }
      // 结果落缓存之后再清空在途标记，避免两个微任务缝隙里再挤出发重复探测
      digestPromise = null;
      return value;
    });
  return digestPromise;
}

/**
 * 本轮探测到的指纹快照（只读，不写 meta）。拿不到时返回 null，调用方按「全部视为变化」处理。
 */
function peekStamps(): Promise<Record<string, string> | null> {
  return probeDigests();
}

/**
 * 某一路数据相对上次是否变化 —— 只比较，不落新指纹。
 *
 * 探测失败/后台不支持 digest 时一律算「变了」：宁可退回每轮重拉全量的旧行为，
 * 也不能因为探测没结果就漏同步。
 */
function stampDiffers(
  ctx: LoaderContext,
  digests: Record<string, string> | null,
  source: StampSource,
): boolean {
  const next = digests?.[source];
  if (!next) return true;
  return ctx.meta.get(STAMP_KEYS[source]) !== next;
}

/**
 * 把这一轮的指纹落盘，作为下一轮的比较基准 —— 必须等对应的那一路全量拉取成功后再调。
 *
 * 先拉成功再落，是为了保住「后台恢复后自动切回 API 数据」这条自愈路径：
 * 探测接口很轻、常常能通，而全量正文可能超时；若拉失败也照样落指纹，下一轮会比出
 * 「没变化」从而永远不再重拉，前台就会一直停在本地 markdown 兜底内容上。
 * 反过来，落「拉取之前」抓到的指纹意味着：拉取期间若又有改动，下一轮一比就发现不同，
 * 宁可多拉一次也不漏。
 */
function commitStamps(
  ctx: LoaderContext,
  digests: Record<string, string> | null,
  sources: StampSource[],
): void {
  if (!digests) return;
  for (const source of sources) {
    const value = digests[source];
    if (value) ctx.meta.set(STAMP_KEYS[source], value);
  }
}

/**
 * Media alt 映射的模块级缓存：posts / notes / projects 三个 loader 共享同一份 Promise，
 * 只发起一次 /api/media 请求。轮询时会重新拉取并 setAltMap，供下一次 markdown 渲染使用。
 */
let mediaAltPromise: Promise<Map<string, string>> | null = null
/** 当前生效的 altMap 指纹：渲染侧用它判断「本 loader 上次渲染用的 alt 内容是否已过期」 */
let currentMediaFp = ''
const fingerprintMediaMap = (m: Map<string, string>) =>
  JSON.stringify([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
function loadMediaAltMap(): Promise<Map<string, string>> {
  if (!mediaAltPromise) {
    mediaAltPromise = fetchMediaAltMap().then((m) => {
      setAltMap(m)
      currentMediaFp = fingerprintMediaMap(m)
      return m
    })
  }
  return mediaAltPromise
}

/** meta 中保存「本 loader 最近一次渲染实际使用的 media 指纹」的 key */
const MEDIA_RENDERED_KEY = 'media-rendered-fp'

/** 正在进行的 Media alt 重载：posts 与 notes 同一轮都检测到变化时，只打一次 /api/media */
let mediaReloadPromise: Promise<Map<string, string>> | null = null

/**
 * Media alt 变更检测与重载（仅在后台指纹显示 Media 变了时才真正拉数据）。
 *
 * 返回「本 loader 已渲染内容所用指纹」与「当前 altMap 指纹」是否不一致：
 * 不一致则调用方需要重渲染 markdown，把新 alt 补进已存的 HTML
 * （<img alt> 是渲染时写死的，不重渲染就一直是旧值）。
 * 判定不再依赖「本次 map vs 上次 map」的全局比较——那份比较结果与
 * commitStamps（全 loader 共享的后台指纹）语义不一致，可能 stamp 已推进而某路
 * loader 的正文里 alt 仍是旧值，造成永久陈旧。渲染指纹由 storeEntries 逐 loader 落进 ctx.meta。
 */
async function refreshMediaAltMap(
  ctx: LoaderContext,
  digests: Record<string, string> | null,
): Promise<boolean> {
  if (stampDiffers(ctx, digests, 'media')) {
    // posts 与 notes 同一轮都检测到变化时，只打一次 /api/media
    if (!mediaReloadPromise) {
      mediaReloadPromise = (async () => {
        mediaAltPromise = null;
        return loadMediaAltMap();
      })().finally(() => {
        mediaReloadPromise = null;
      });
    }
    // 抛错时不落指纹：下一轮仍会重试，不会把「没拉到」记成「没变化」
    await mediaReloadPromise;
    commitStamps(ctx, digests, ['media']);
  }
  return currentMediaFp !== ctx.meta.get(MEDIA_RENDERED_KEY);
}

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
type RenderedMarkdown = Awaited<ReturnType<LoaderContext['renderMarkdown']>>;
interface RenderCacheEntry {
  body: string;
  file?: string;
  rendered?: RenderedMarkdown;
}
interface RenderCache {
  mediaFp: string;
  entries: Map<string, RenderCacheEntry>;
}
const RENDER_CACHE_KEY = 'render-cache';

async function storeEntries(
  ctx: LoaderContext,
  store: DataStore,
  entries: MdEntry[],
  fileOf?: (id: string) => string | undefined,
) {
  // 单条脏数据只该影响它自己：parseData/renderMarkdown 逐条 try-catch，
  // 坏条目跳过并计数告警，绝不让整批拉取失败（进而误降级成本地 markdown 兜底）。
  let skipped = 0;

  // alt 映射会烧进渲染产物：media 指纹一变整个缓存作废；正文/来源文件没变的条目复用上轮 rendered，
  // 轮询检测到「某一路变了」时不再把所有条目重渲一遍。
  const cached = ctx.meta.get(RENDER_CACHE_KEY) as RenderCache | undefined;
  const cache =
    cached && cached.mediaFp === currentMediaFp ? cached.entries : new Map<string, RenderCacheEntry>();

  for (const entry of entries) {
    // 用前台 collection schema 校验/清洗数据
    let data: Awaited<ReturnType<typeof ctx.parseData>>;
    try {
      data = await ctx.parseData({ id: entry.id, data: entry.data });
    } catch (error) {
      skipped += 1;
      ctx.logger.warn(`[payload-loader] 数据校验失败，跳过该条 ${entry.id}: ${(error as Error).message}`);
      continue;
    }

    // 传 fileURL 以便 markdown 内相对图片路径解析
    const file = fileOf?.(entry.id);
    const fileURL = file ? pathToFileURL(file) : undefined;

    const key = String(entry.id);
    const prev = cache.get(key);
    let rendered: RenderedMarkdown | undefined;
    let renderFailed = false;
    try {
      if (prev && prev.body === entry.body && prev.file === file) {
        rendered = prev.rendered;
      }
      if (!rendered) {
        rendered = await ctx.renderMarkdown(entry.body, fileURL ? { fileURL } : undefined);
      }
    } catch (error) {
      // 个别条目渲染失败不阻塞整体，仅告警并保留原始 body
      ctx.logger.warn(`[payload-loader] 渲染失败 ${entry.id}: ${(error as Error).message}`);
      renderFailed = true;
    }

    if (renderFailed) {
      store.set({ id: entry.id, data, body: entry.body });
      cache.delete(key);
    } else {
      store.set({ id: entry.id, data, body: entry.body, rendered });
      cache.set(key, { body: entry.body, file, rendered });
    }
  }

  if (skipped > 0) {
    ctx.logger.warn(`[payload-loader] 本批 ${entries.length} 条中有 ${skipped} 条脏数据被跳过（其余照常入库）`);
  }

  // 删除本次结果里已经不存在的条目：轮询只 set 不删的话，
  // 后台删掉的文章/随笔会永远残留在仓库里（前台仍能看到已删内容）。
  // 判断依据是「本批出现过的 id」（含被跳过的脏条目）：脏条目保留仓库里的旧版本，
  // 好过让一篇文章因后台一次字段错误而从前台消失。
  const liveIds = new Set(entries.map((e) => String(e.id)));
  for (const id of [...store.keys()]) {
    if (!liveIds.has(String(id))) {
      store.delete(id);
      cache.delete(String(id));
    }
  }

  // meta 官方类型只标了 string 值，但运行时就是普通 Map；渲染缓存（含 thenable）必须跨轮询存活，双断言塞回去
  ctx.meta.set(RENDER_CACHE_KEY, { mediaFp: currentMediaFp, entries: cache } as unknown as string);
  // 本 loader 的产物此刻确实基于当前 altMap —— 与 refreshMediaAltMap 的判定配对落盘
  ctx.meta.set(MEDIA_RENDERED_KEY, currentMediaFp);
}

/** 文章加载器：API 优先，本地 markdown 兜底 */
export const payloadPostsLoader: Loader = {
  name: 'payload-posts-loader',
  async load(ctx) {
    const localBase = path.join(process.cwd(), 'src/content/posts');
    const urlsOf = new Map<string, string>();

    // try 只包「拉数据」这一步：渲染/写仓库的异常不该被当成「后台不可用」，
    // 否则单篇 markdown 渲染失败会把整批 API 数据静默降级成本地兜底内容。
    let entries: MdEntry[] | null = null;
    let fetchError: Error | null = null;
    // 拉数据之前先抓一份指纹快照，等这一路真的拉成功了再落盘（见 commitStamps）
    const stamps = await peekStamps();
    try {
      // 先注入 Media alt 映射，确保 renderMarkdown 时 rehypeImgAttrs 能查到 alt；
      // 同时把 map 传给 fetchPosts，让它给每篇文章的封面写入 data.coverAlt
      const altMap = await loadMediaAltMap();
      entries = await fetchPosts(altMap);
    } catch (error) {
      fetchError = error as Error;
    }

    if (entries) {
      ctx.logger.info(`[payload-loader] 文章：从后台 API 载入 ${entries.length} 条`);
      await storeEntries(ctx, ctx.store, entries);
      ctx.meta.set(DIGEST_KEYS.posts, ctx.generateDigest(JSON.stringify(entries)));
      commitStamps(ctx, stamps, ['posts', 'media', 'settings', 'nav']);
    } else {
      // 后台不可用 → 回退本地 markdown
      const files = collectLocalMarkdown(localBase);
      files.forEach(({ id, file }) => urlsOf.set(id, file));
      const fallbackEntries = localEntries(files);
      ctx.logger.warn(
        `[payload-loader] 后台不可用（${fetchError?.message}），回退本地 markdown：${fallbackEntries.length} 篇`,
      );
      if (fallbackEntries.length === 0) {
        ctx.logger.error(
          '[payload-loader] ⚠️ 后台拉取失败且没有任何本地 markdown 兜底：' +
            '前台会退回默认文案（模板作者名），并且不会生成任何文章详情页（/posts/* 会 404）。' +
            `请检查 PUBLIC_PAYLOAD_URL 是否指向真实后台地址（当前解析为 ${PAYLOAD_URL}）。`,
        );
      }
      await storeEntries(ctx, ctx.store, fallbackEntries, (id) => urlsOf.get(id));
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

    let entries: MdEntry[] | null = null;
    let fetchError: Error | null = null;
    const stamps = await peekStamps();
    try {
      const altMap = await loadMediaAltMap();
      const apiEntries = await fetchNotes();
      // 用 altMap 回填随笔封面 alt（如随笔封面也在 Media 表里配置了 alt）
      for (const e of apiEntries) {
        const cover = e.data?.cover;
        if (typeof cover === 'string' && cover) {
          const alt = altMap.get(cover);
          if (alt) e.data.coverAlt = alt;
        }
      }
      entries = apiEntries;
    } catch (error) {
      fetchError = error as Error;
    }

    if (entries) {
      ctx.logger.info(`[payload-loader] 随笔：从后台 API 载入 ${entries.length} 条`);
      await storeEntries(ctx, ctx.store, entries);
      ctx.meta.set(DIGEST_KEYS.notes, ctx.generateDigest(JSON.stringify(entries)));
      commitStamps(ctx, stamps, ['notes', 'media']);
    } else {
      // 后台不可用 → 回退本地 markdown
      const files = collectLocalMarkdown(localBase);
      files.forEach(({ id, file }) => urlsOf.set(id, file));
      const fallbackEntries = localEntries(files);
      ctx.logger.warn(
        `[payload-loader] 后台不可用（${fetchError?.message}），回退本地 markdown：${fallbackEntries.length} 条`,
      );
      if (fallbackEntries.length === 0) {
        ctx.logger.error(
          '[payload-loader] ⚠️ 后台拉取失败且没有任何本地 markdown 兜底：随笔页会显示「还没有随笔」。' +
            `请检查 PUBLIC_PAYLOAD_URL（当前解析为 ${PAYLOAD_URL}）。`,
        );
      }
      await storeEntries(ctx, ctx.store, fallbackEntries, (id) => urlsOf.get(id));
    }

    // 无论初始加载是否成功都启用轮询（理由同上：后台恢复后自动切回 API 数据）
    schedulePolling(ctx, '随笔', pollNotes);
  },
};

/** 项目加载器：API 优先（项目已全部入库，无本地 markdown 兜底） */
export const payloadProjectsLoader: Loader = {
  name: 'payload-projects-loader',
  async load(ctx) {
    const stamps = await peekStamps();
    try {
      const entries = await fetchProjects();
      ctx.logger.info(`[payload-loader] 项目：从后台 API 载入 ${entries.length} 条`);
      for (const entry of entries) {
        // 单条脏数据跳过并计数，不让整批初始载入失败（同 storeEntries 的策略）
        try {
          const data = await ctx.parseData({ id: entry.id, data: entry });
          ctx.store.set({ id: entry.id, data });
        } catch (error) {
          ctx.logger.warn(`[payload-loader] 项目数据校验失败，跳过 ${entry.id}: ${(error as Error).message}`);
        }
      }
      ctx.meta.set(DIGEST_KEYS.projects, ctx.generateDigest(JSON.stringify(entries)));
      commitStamps(ctx, stamps, ['projects']);
    } catch (error) {
      ctx.logger.warn(`[payload-loader] 项目后台不可用（${(error as Error).message}），跳过`);
    }

    schedulePolling(ctx, '项目', pollProjects);
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
/**
 * 按 loader 名登记轮询句柄。
 * content 配置热重载会让同一个 loader 的 load() 再跑一次，没有这份登记表
 * 就会叠加出多个 setInterval（越跑越多的后台请求），且永远无法回收。
 */
const pollingTimers = new Map<string, ReturnType<typeof setInterval>>()

function schedulePolling(
  ctx: LoaderContext,
  label: string,
  pollSource: (ctx: LoaderContext) => Promise<boolean>,
) {
  if (!ctx.watcher) return;

  // 先回收同一 loader 上一轮的轮询，再挂新的
  // 键用 ctx.collection：LoaderContext 上没有 name（name 属于 Loader 对象本身）
  const previous = pollingTimers.get(ctx.collection);
  if (previous) clearInterval(previous);

  ctx.logger.info(`[payload-loader] 已启用 dev 自动同步（每 ${AUTO_REFRESH_MS / 1000}s 轮询 ${label}）`);

  let running = false;
  const poll = async () => {
    if (running) return;
    // 探测退避期间跳过本轮：否则 fail-open（探测无结果→视为全部变化）会每 AUTO_REFRESH_MS 全量重拉
    if (Date.now() < probeBackoffUntil) return;
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

  pollingTimers.set(ctx.collection, setInterval(() => void poll(), AUTO_REFRESH_MS));
}

/**
 * 轮询文章 + 站点设置 + 导航：有任何**真实内容**变化时更新/记录，返回是否需要刷新页面
 *
 * 先看后台指纹，只有变了的那一路才去拉全量正文（探测失败时 stampDiffers 一律返回 true，
 * 等价于旧版「每轮全量重拉」）。
 * 设置/导航不进 store：它们由 SSR 渲染时实时读取，这里拉一次只为触发页面刷新。
 *
 * 「changed」必须同时满足两个条件才会触发整页 reload：
 *   1. 这一路全量拉取成功（失败时保留旧指纹、不置 changed —— 否则探测能通、全量超时，
 *      每 3s 都会误判「有变化」把 dev 页面刷到不可用）；
 *   2. 正文摘要（digest）相对上一轮真的变了（指纹探测整体不可用时，
 *      stampDiffers 恒为 true，靠 digest 比较兜底防「每轮都 reload」）。
 */
async function pollPostsAndSettings(ctx: LoaderContext): Promise<boolean> {
  let changed = false;
  const digests = await peekStamps();

  // Media alt 变更会直接影响前台图片 alt 展示；altMap 更新后，已存储的 markdown HTML
  // 里 <img alt=""> 是旧值，需重新 renderMarkdown 让 rehypeImgAttrs 用新 map 补齐
  const mediaAltChanged = await refreshMediaAltMap(ctx, digests);

  if (stampDiffers(ctx, digests, 'posts') || mediaAltChanged) {
    const altMap = mediaAltPromise ? await mediaAltPromise : new Map<string, string>();
    const entries = await fetchPosts(altMap);
    const nextDigest = ctx.generateDigest(JSON.stringify(entries));
    const contentChanged = ctx.meta.get(DIGEST_KEYS.posts) !== nextDigest;
    await storeEntries(ctx, ctx.store, entries);
    ctx.meta.set(DIGEST_KEYS.posts, nextDigest);
    commitStamps(ctx, digests, ['posts']);
    changed = changed || contentChanged || mediaAltChanged;
  }

  if (stampDiffers(ctx, digests, 'settings')) {
    const data = await fetchSiteSettings();
    // 拉到 null 说明这次请求失败：不置 changed、不落指纹（下一轮重试）。
    // 修复「探测成功 + 全量失败」时每 3s 误判变化触发整页 reload 的循环。
    if (data) {
      const nextDigest = ctx.generateDigest(JSON.stringify(data));
      const contentChanged = ctx.meta.get(DIGEST_KEYS.settings) !== nextDigest;
      ctx.meta.set(DIGEST_KEYS.settings, nextDigest);
      commitStamps(ctx, digests, ['settings']);
      changed = changed || contentChanged;
    }
  }

  if (stampDiffers(ctx, digests, 'nav')) {
    const navItems = await fetchNavItems();
    // 同上：失败（null）时保持旧指纹、不刷新；[] 是合法的「导航清空」，照常应用
    if (navItems) {
      const nextDigest = ctx.generateDigest(JSON.stringify(navItems));
      const contentChanged = ctx.meta.get(DIGEST_KEYS.nav) !== nextDigest;
      ctx.meta.set(DIGEST_KEYS.nav, nextDigest);
      commitStamps(ctx, digests, ['nav']);
      changed = changed || contentChanged;
    }
  }

  return changed;
}

/** 轮询随笔：指纹有变化时更新 store，仅当正文真的变了（或 alt 映射变了）才触发刷新 */
async function pollNotes(ctx: LoaderContext): Promise<boolean> {
  const digests = await peekStamps();
  const mediaAltChanged = await refreshMediaAltMap(ctx, digests);
  if (!stampDiffers(ctx, digests, 'notes') && !mediaAltChanged) return false;

  const altMap = mediaAltPromise ? await mediaAltPromise : new Map<string, string>();
  const entries = await fetchNotes();
  for (const e of entries) {
    const cover = e.data?.cover;
    if (typeof cover === 'string' && cover) {
      const alt = altMap.get(cover);
      if (alt) e.data.coverAlt = alt;
    }
  }
  const nextDigest = ctx.generateDigest(JSON.stringify(entries));
  const contentChanged = ctx.meta.get(DIGEST_KEYS.notes) !== nextDigest;
  await storeEntries(ctx, ctx.store, entries);
  // 与 posts 路径对齐：store 写成功后再落 digest，中途抛错下一轮会重拉而不是静默漏同步
  ctx.meta.set(DIGEST_KEYS.notes, nextDigest);
  commitStamps(ctx, digests, ['notes']);
  return contentChanged || mediaAltChanged;
}

/** 轮询项目：指纹有变化时清空并重新写入，仅当正文真的变了才触发刷新 */
async function pollProjects(ctx: LoaderContext): Promise<boolean> {
  const digests = await peekStamps();
  if (!stampDiffers(ctx, digests, 'projects')) return false;
  const entries = await fetchProjects();
  const nextDigest = ctx.generateDigest(JSON.stringify(entries));
  const contentChanged = ctx.meta.get(DIGEST_KEYS.projects) !== nextDigest;
  // 先全部 parse 完，再 clear + 同步逐条 set：await 不夹在 clear 和 set 之间，
  // 避免「已清空但新数据还在逐条 await」的空窗期让并发读取拿到空仓库
  const parsed: Array<{ id: string; data: Awaited<ReturnType<typeof ctx.parseData>> }> = [];
  for (const entry of entries) {
    // 单条脏数据跳过并计数，不让整批轮询失败（同 storeEntries 的策略）
    try {
      parsed.push({ id: entry.id, data: await ctx.parseData({ id: entry.id, data: entry }) });
    } catch (error) {
      ctx.logger.warn(`[payload-loader] 项目数据校验失败，跳过 ${entry.id}: ${(error as Error).message}`);
    }
  }
  ctx.store.clear();
  for (const { id, data } of parsed) {
    ctx.store.set({ id, data });
  }
  ctx.meta.set(DIGEST_KEYS.projects, nextDigest);
  commitStamps(ctx, digests, ['projects']);
  return contentChanged;
}