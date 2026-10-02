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

/** 基于 node:http 的 GET+JSON 请求，超时或非 2xx 时抛错（超时放宽以容忍后台首次编译） */
function fetchJson<T>(path: string, timeoutMs = 20000): Promise<T> {
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

/** 关于页项目条目（来自后台 projects 集合） */
export interface ProjectEntry {
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

/** 把浅关系字段（单选或多选）归一为字符串名列表 */
function namesOf(refs?: (RefDoc | number)[] | RefDoc | number | null): string[] | undefined {
  if (!refs) return undefined;
  const arr = Array.isArray(refs) ? refs : [refs];
  if (arr.length === 0) return undefined;
  const names = arr.map((r) => (typeof r === 'object' && r !== null ? r.name : String(r))).filter(Boolean);
  return names.length > 0 ? names : undefined;
}

/** 从单选/多选关系里取首个名称（用于拼接 URL） */
function firstCategoryName(ref?: RefDoc | number | (RefDoc | number)[] | null): string {
  if (!ref) return 'uncategorized';
  const first = Array.isArray(ref) ? ref[0] : ref;
  if (!first) return 'uncategorized';
  return typeof first === 'object' ? first.name || 'uncategorized' : String(first);
}

/** 生成文章前台路径：/posts/{分类名}/{数字ID}/ */
function postPathOf(doc: { id: number; categories?: RefDoc | number | null }): string {
  return `/posts/${encodeURIComponent(firstCategoryName(doc.categories))}/${String(doc.id)}/`;
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
 */
export async function fetchSyncDigest(timeoutMs = 8000): Promise<SyncDigests | null> {
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
export async function fetchMediaAltMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { docs } = await fetchJson<PayloadListResponse<ApiMedia>>(
      '/api/media?limit=0&select[url]=url&select[alt]=alt',
    );
    for (const doc of docs) {
      const url = doc?.url;
      const alt = typeof doc?.alt === 'string' ? doc.alt.trim() : undefined;
      if (!url || !alt) continue;
      map.set(url, alt);
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

/** 拉取文章列表并转为 markdown 条目（按数字主键作为 id，与前台路径 /posts/{分类}/{数字ID}/ 一致）
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
        // id 使用数字主键：前台路径 /posts/{分类}/{数字ID}/
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
          categories: namesOf(doc.categories),
          tags: namesOf(doc.tags),
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
        tags: namesOf(doc.tags),
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

/** 把后台「每行一条 「文字 链接」」的导航文本解析为结构化数组（与后台字段格式一致） */
function parseNavLines(text?: string | null): Array<{ href: string; label: string }> {
  if (!text) return []
  const out: Array<{ href: string; label: string }> = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 用最后一个空格切分，文字可含空格，链接为 URL 通常不含空格
    const sp = trimmed.lastIndexOf(' ')
    if (sp === -1) continue
    const label = trimmed.slice(0, sp).trim()
    const href = trimmed.slice(sp + 1).trim()
    // 协议白名单：javascript: 之类的导航项退化成惰性链接，不进 href
    if (label && href) out.push({ href: safeHref(href, '#'), label })
  }
  return out
}

/** 导航项（来自后台「导航管理」Global 单例）；不可用时返回 null */
export async function fetchNavItems(): Promise<Array<{ href: string; label: string }> | null> {
  try {
    const data = await fetchJson<{ navItems?: string | null }>('/api/globals/navigation');
    return parseNavLines(data?.navItems);
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
      icon: doc.icon ?? 'github',
      // 两个链接字段都是后台自由填写，过一次协议白名单：
      // href 不合法退化成惰性 '#'，articleHref 不合法退化成 ''（前台据此整条「笔记」链接不渲染）
      href: safeHref(doc.href, '#'),
      articleHref: safeHref(doc.articleHref, ''),
      stars: Number(doc.stars ?? 0),
      tags: linesOf(doc.tags),
      sortOrder: Number(doc.sortOrder ?? 0),
    }));
}