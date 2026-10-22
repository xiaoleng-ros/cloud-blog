/**
 * Payload 后台 REST API 客户端
 *
 * 功能：
 * 1. 从后台（PUBLIC_PAYLOAD_URL，默认 http://localhost:9527）拉取文章/随笔/分类/标签/站点设置
 * 2. 将 Payload API 返回的数据结构转换为前台 content schema 兼容的格式
 * 3. 请求失败/后台不可用时抛出异常，由调用方回退到本地 markdown
 *
 * 说明：使用 node:http / node:https 而非全局 fetch——本机网络环境下 undici(fetch)
 * 可能无法连接 localhost 后台，而 node 原生模块工作正常，且 loader 仅在 Node 侧运行。
 * 注意：node:http 只支持 http 协议，线上后台是 https，必须按协议选择对应模块，
 * 否则会报 `Protocol "https:" not supported. Expected "http:"` 导致构建时拉不到数据。
 */
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { safeHref } from 'cloud-blog/shared/html-safety';
import { DEFAULT_PROJECT_ICON, sanitizeTerm } from 'cloud-blog/shared/post-utils';
import { parseFreeTextLines } from 'cloud-blog/shared/free-text-lines';

/**
 * 后台地址解析优先级：
 *   1. PUBLIC_PAYLOAD_URL（显式配置，本地/云端都可用）
 *   2. SITE_URL（一体化部署时前台后台同域，直接用它拼 /api）
 *   3. http://localhost:9527（本地开发后台的默认端口）
 * 只填域名，**不要带 /api 后缀**（下面的请求路径会自己拼 /api/xxx）。
 *
 * 注意：显式替换 localhost 为 127.0.0.1 —— Windows 上 localhost 可能被解析为 IPv6 ::1，
 * 导致连接后台超时（TypeError: network error）。
 */
function resolvePayloadUrl(): string {
  const explicit = import.meta.env.PUBLIC_PAYLOAD_URL?.trim();
  const siteUrl = import.meta.env.SITE_URL?.trim();
  const base = explicit || siteUrl || 'http://localhost:9527';
  return base
    .trim()
    .replace(/\/+$/, '')
    // 容忍误填成 https://domain/api 的写法
    .replace(/\/api$/i, '')
    .replace(/localhost/gi, '127.0.0.1');
}

export const PAYLOAD_URL = resolvePayloadUrl();

/** 基于 node:http 的 GET+JSON 请求，超时或非 2xx 时抛错
 *  超时 30s：容忍后台 Turbopack 冷编译 + Supabase pooler 偶发慢查询（免费档连接池
 *  在并发下单查询可达 20s，20s 超时刚好踩在边界上会误杀正常请求） */
function fetchJson<T>(path: string, timeoutMs = 30000): Promise<T> {
  const url = `${PAYLOAD_URL}${path}`;
  // http / https 共用同一套 options 与回调签名，按协议选择模块
  const get = url.startsWith('https:') ? httpsGet : httpGet;
  return new Promise<T>((resolve, reject) => {
    const req = get(
      url,
      { timeout: timeoutMs, headers: { accept: 'application/json' } },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw) as T);
            } catch (error) {
              reject(new Error(`Payload API JSON 解析失败: ${(error as Error).message}`));
            }
          } else {
            reject(new Error(`Payload API HTTP ${res.statusCode}: ${path}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Payload API 请求超时: ${path}`)));
    req.on('error', (error) => reject(error));
  });
}

/** Payload REST 集合响应 */
interface PayloadListResponse<T> {
  docs: T[];
  totalDocs: number;
}

/** Payload 文档的浅关系字段（depth=1 时展开为对象） */
interface RefDoc {
  id: number;
  name: string;
  slug?: string;
}

/** Payload posts 集合的 API 形状（categories 为单选关系） */
interface ApiPost {
  id: number;
  title: string;
  createdAt: string;
  description?: string | null;
  cover?: string | null;
  categories?: RefDoc | number;
  tags?: (RefDoc | number)[];
  keywords?: string | null;
  ai?: string | null;
  sticky?: number | null;
  status: 'draft' | 'published';
  content?: string | null;
}

/** Payload notes 集合的 API 形状（categories 为单选关系） */
interface ApiNote {
  id: number;
  date: string;
  title?: string | null;
  mood?: string | null;
  categories?: RefDoc | number;
  status?: string | null;
  tags?: (RefDoc | number)[];
  content?: string | null;
}

/** 转换给 content schema 使用的 markdown 条目（id + data + body） */
export interface MdEntry {
  id: string;
  data: Record<string, unknown>;
  body: string;
}

/** Payload projects 集合的 API 形状 */
interface ApiProject {
  id: number;
  group: string;
  groupDescription?: string | null;
  title: string;
  owner?: string | null;
  description?: string | null;
  icon?: string | null;
  href?: string | null;
  articleHref?: string | null;
  stars?: number | null;
  tags?: string | null;
  sortOrder?: number | null;
  status: string;
}

/** 关于页项目条目（来自后台 projects 集合）。用 type 而非 interface：
 *  接口没有隐式索引签名，无法作为 Record<string, unknown> 传给 loader 的 ctx.parseData */
export type ProjectEntry = {
  id: string;
  group: string;
  groupDescription?: string;
  title: string;
  owner?: string;
  description?: string;
  icon: string;
  href?: string;
  articleHref?: string;
  stars: number;
  tags?: string[];
  sortOrder: number;
}

/**
 * 把浅关系字段（单选或多选）归一为字符串名列表。
 * Payload 对 status !== published 的关联文档会回退为裸数字 id（depth 过滤后不展开）：
 * 数字只当无效条目丢弃（不渲染为 "123" 假标签）；若同一条目还有已展开的 name，照常保留。
 */
function namesOf(refs?: (RefDoc | number)[] | RefDoc | number | null): string[] | undefined {
  if (!refs) return undefined;
  const arr = Array.isArray(refs) ? refs : [refs];
  const names = arr
    .filter((r): r is RefDoc => typeof r === 'object' && r !== null && !Number.isNaN(r.id))
    .map((r) => r.name)
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  return names.length > 0 ? names : undefined;
}

/**
 * 把浅关系字段（单选或多选）归一为「分类标识」(slug) 列表，下标与 namesOf 对齐。
 * 文章 URL 里的分类段优先用 slug。slug 缺失的位置放空串（不是跳过），
 * 保证 categorySlugs[i] 永远对应 categories[i]；全空时返回 undefined。
 */
function slugsOf(
  refs?: (RefDoc | number)[] | RefDoc | number | null,
): string[] | undefined {
  if (!refs) return undefined;
  const arr = Array.isArray(refs) ? refs : [refs];
  const slugs = arr
    .filter((r): r is RefDoc => typeof r === 'object' && r !== null && !Number.isNaN(r.id))
    .map((r) => (typeof r.slug === 'string' ? r.slug : ''));
  return slugs.some((s) => s.trim() !== '') ? slugs : undefined;
}

/** 把「每行一个」的文本拆为数组 */
function linesOf(text?: string | null): string[] | undefined {
  if (!text) return undefined;
  const list = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** Payload media 集合的 API 形状（只关心 url 与 alt） */
interface ApiMedia {
  id: number;
  url?: string | null;
  alt?: string | null;
}

/**
 * 取 URL 的路径部分作为归一化 key：去掉协议+域名、去掉 hash 后缀
 * @param url 原始 URL 字符串（可能是绝对 http(s) 或相对路径）
 * @returns 归一化后的路径部分，供 altMap 二次命中
 */
function basenameOfUrl(url: string): string {
  let path = url;
  try {
    if (/^https?:\/\//.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    // 非法 URL 时按原样处理
  }
  return path.split('#')[0];
}

/**
 * 各数据源的「变更指纹」（来自后台 /api/blog-sync?digest=1），值形如 "12:1758000000000"
 * （条数 : 该源最大 updatedAt）。loader 每轮先比这个，再决定要不要重拉全量正文。
 */
export interface SyncDigests {
  version: string
  digests?: Record<string, string>
}

/**
 * 轻量探测各数据源指纹（<1KB，命中后台快照缓存时零查库、不渲染区块）。
 * 失败时返回 null，由调用方退回「无条件重拉全量」的旧行为。
 * 超时 15s：Supabase 免费档 pooler 单查可达 8s，8s 超时刚好踩在边界上会误杀。
 */
export async function fetchSyncDigest(timeoutMs = 15000): Promise<SyncDigests | null> {
  try {
    return await fetchJson<SyncDigests>('/api/blog-sync?digest=1', timeoutMs);
  } catch (error) {
    console.warn(`[payload-api] 指纹探测失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 拉取 Media 集合的 url → alt 映射，供前台 Markdown 正文图片补 alt。
 *
 * 说明：Astro 构建期把 altMap 注入 rehype-img-attrs.mjs 的全局变量，
 * 与前台 CMS SSR 链路（blog-sync.fetchMediaAltMap）保持同一套策略。
 */
/** 归一化 key 集合（M3）：同一 URL 存多形态（原值、去 # 锚点、去 ?query、纯 path），
 *  markdown 里无论写成 `![x](/media/a.svg)`、`![x](/media/a.svg#top)` 还是
 *  绝对 URL，都能命中 alt。原实现只存「原值 + basename」两形态，
 *  正文里带锚点/查询串的同图对不上，alt 缺失。 */
function urlNormalizationKeys(url: string): string[] {
  const noHash = url.split('#')[0];
  const noQuery = noHash.split('?')[0];
  let pathOnly = noQuery;
  try {
    if (/^https?:\/\//.test(noQuery)) pathOnly = new URL(noQuery).pathname;
  } catch {
    // 非法 URL 时按原样处理
  }
  const keys = new Set<string>([url, noHash, noQuery]);
  if (pathOnly && pathOnly !== noQuery) keys.add(pathOnly);
  return [...keys];
}

export async function fetchMediaAltMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // ⚠ select 里必须带 filename：cloud-storage 插件的 url 字段是 afterRead 钩子
    // 按 data.filename 现算出来的虚拟字段，不是库里的列。只选 url/alt 时钩子拿不到
    // filename，url 一律返回 undefined，整张映射表会是空的 —— 而且不报错、没日志，
    // 表现只是「正文图片永远没有 alt」。实测：不选 filename 时 6 条 media 里 0 条有 url。
    const { docs } = await fetchJson<PayloadListResponse<ApiMedia>>(
      '/api/media?limit=0&select[url]=url&select[alt]=alt&select[filename]=filename',
    );
    for (const doc of docs) {
      const url = doc?.url;
      const alt = typeof doc?.alt === 'string' ? doc.alt.trim() : undefined;
      if (!url || !alt) continue;
      for (const key of urlNormalizationKeys(url)) map.set(key, alt);
      // 兜底：按 basename 再存一份，让 markdown 里的相对路径也能命中
      map.set(basenameOfUrl(url), alt);
    }
  } catch (error) {
    // 拉取失败不影响前台构建，回退为「无 alt」渲染
    console.warn(
      `[payload-api] Media alt 拉取失败: ${(error as Error).message}`,
    );
  }
  return map;
}

/** 拉取文章列表并转为 markdown 条目（按数字主键作为 id，与前台路径 /posts/{分类标识}/{数字ID} 一致）
 * @param altMap Media 集合 url → alt 映射；若文章封面在 Media 表里配了 alt，一并写入 data.coverAlt
 */
export async function fetchPosts(altMap?: Map<string, string>): Promise<MdEntry[]> {
  const { docs } = await fetchJson<PayloadListResponse<ApiPost>>(
    '/api/posts?depth=1&limit=0&sort=-sticky,-createdAt',
  );

  return docs
    .filter((doc) => doc.status === 'published')
    .map((doc) => {
      const rawCover = doc.cover ?? undefined;
      // cover 会进 og:image / JSON-LD / <img>：过一次协议白名单，
      // 协议相对（//evil.com/x.png）/javascript: 之类的后台脏值回落默认封面
      const cover = rawCover ? safeHref(rawCover, '/covers/default-cover.svg') : undefined;
      const coverAlt = cover && altMap ? (rawCover ? altMap.get(rawCover) : undefined) ?? altMap.get(cover) ?? undefined : undefined;
      return {
        // id 使用数字主键：前台路径 /posts/{分类标识}/{数字ID}
        id: String(doc.id),
        data: {
          // 数字 ID 挂在 data.id 上，前台解析路径时用
          id: String(doc.id),
          title: doc.title,
          description: doc.description ?? undefined,
          // 后台不再维护「发布时间」，前台用创建时间（createdAt）兜底，保证排序与展示正常。
          // 这里是 UTC ISO instant（与时区无关）；「哪天发布」的展示/归档统一由
          // shared/post-utils 的 toShanghaiParts/formatDate 按 Asia/Shanghai 定格
          date: String(doc.createdAt),
          cover,
          coverAlt,
          // 分类/标签名做 URL 段安全清洗：带 / # % 的后台脏值会让路由 404
          categories: namesOf(doc.categories)?.map(sanitizeTerm).filter(Boolean) || undefined,
          // 与 categories 下标对齐的分类标识：文章 URL 分类段优先用它（/posts/daily/46）
          categorySlugs: slugsOf(doc.categories),
          tags: namesOf(doc.tags)?.map(sanitizeTerm).filter(Boolean) || undefined,
          keywords: linesOf(doc.keywords),
          ai: linesOf(doc.ai),
          sticky: doc.sticky ?? undefined,
        },
        body: doc.content ?? '',
      };
    });
}

/** 拉取随笔列表并转为 markdown 条目（以 date 作为 id） */
export async function fetchNotes(): Promise<MdEntry[]> {
  const { docs } = await fetchJson<PayloadListResponse<ApiNote>>(
    '/api/notes?depth=1&limit=0&sort=date',
  );

  return docs
    // 随笔同样区分草稿/已发布，前台只展示已发布
    .filter((doc) => doc.status === 'published')
    .map((doc) => ({
      // 日期前 10 位保持与本地 markdown 文件命名一致，再拼接后台文档 id：
      // 只用日期时同一天的多条随笔会共用同一个 id，后进 store 的会静默覆盖前一条
      id: `${String(doc.date).slice(0, 10)}-${doc.id}`,
      data: {
        date: doc.date,
        title: doc.title ?? undefined,
        mood: doc.mood ?? undefined,
        tags: namesOf(doc.tags)?.map(sanitizeTerm).filter(Boolean) || undefined,
      },
      body: doc.content ?? '',
    }));
}

/** 站点设置（来自后台 Global 单例）；不可用时返回 null */
export async function fetchSiteSettings(): Promise<Record<string, any> | null> {
  try {
    const data = await fetchJson<Record<string, any>>('/api/globals/site-settings');
    return data;
  } catch {
    return null;
  }
}

/**
 * 导航项（来自后台「导航管理」Global 单例）；不可用时返回 null。
 * 行格式「文字 链接」共用 shared/free-text-lines 解析器（与社交/页脚同一套，M4）。
 */
export async function fetchNavItems(): Promise<Array<{ href: string; label: string }> | null> {
  try {
    const data = await fetchJson<{ navItems?: string | null }>('/api/globals/navigation');
    // 导航条目必须有链接：allowEmptyHref=false，惰性 '#' 不出现。
    // parseFreeTextLines 内部已用 normalizeSiteHref 去掉站内路径的尾斜杠
    // （EdgeOne CDN 会把带尾斜杠的 URL 308 跳走，跳转头的 UTF-8 乱码会让中文路径 404）。
    return parseFreeTextLines(data?.navItems, '#', false).map((i) => ({
      href: i.href,
      label: i.name,
    }));
  } catch {
    return null;
  }
}

/** 拉取项目列表（关于页项目区，按 sortOrder 升序） */
export async function fetchProjects(): Promise<ProjectEntry[]> {
  const { docs } = await fetchJson<PayloadListResponse<ApiProject>>(
    '/api/projects?limit=0&sort=sortOrder',
  );

  return docs
    .filter((doc) => doc.status === 'published')
    .map((doc) => ({
      id: String(doc.id),
      group: doc.group,
      groupDescription: doc.groupDescription ?? undefined,
      title: doc.title,
      owner: doc.owner ?? undefined,
      description: doc.description ?? undefined,
      icon: doc.icon ?? DEFAULT_PROJECT_ICON,
      // 两个链接字段都是后台自由填写，过一次协议白名单：
      // href 不合法退化成惰性 '#'，articleHref 不合法退化成 ''（前台据此整条「笔记」链接不渲染）
      href: safeHref(doc.href, '#'),
      articleHref: safeHref(doc.articleHref, ''),
      stars: Number(doc.stars ?? 0),
      tags: linesOf(doc.tags),
      sortOrder: Number(doc.sortOrder ?? 0),
    }));
}