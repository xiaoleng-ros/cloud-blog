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

/** Payload posts 集合的 API 形状 */
interface ApiPost {
  id: number;
  title: string;
  slug: string;
  createdAt: string;
  description?: string | null;
  cover?: string | null;
  categories?: (RefDoc | number)[];
  tags?: (RefDoc | number)[];
  keywords?: string | null;
  ai?: string | null;
  sticky?: number | null;
  status: 'draft' | 'published';
  content?: string | null;
}

/** Payload notes 集合的 API 形状 */
interface ApiNote {
  id: number;
  date: string;
  title?: string | null;
  mood?: string | null;
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

/** 把浅关系字段归一为字符串名列表 */
function namesOf(refs?: (RefDoc | number)[]): string[] | undefined {
  if (!refs?.length) return undefined;
  return refs.map((r) => (typeof r === 'object' ? r.name : String(r)));
}

/** 把「每行一个」的文本拆为数组 */
function linesOf(text?: string | null): string[] | undefined {
  if (!text) return undefined;
  const list = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** 拉取文章列表并转为 markdown 条目（按 slug 作为 id，与前台路径一致） */
export async function fetchPosts(): Promise<MdEntry[]> {
  const { docs } = await fetchJson<PayloadListResponse<ApiPost>>(
    '/api/posts?depth=1&limit=0&sort=-sticky,-createdAt',
  );

  return docs
    .filter((doc) => doc.status === 'published')
    .map((doc) => ({
      id: doc.slug,
      data: {
        title: doc.title,
        description: doc.description ?? undefined,
        // 后台不再维护「发布时间」，前台用创建时间（createdAt）兜底，保证排序与展示正常
        date: String(doc.createdAt),
        cover: doc.cover ?? undefined,
        categories: namesOf(doc.categories),
        tags: namesOf(doc.tags),
        keywords: linesOf(doc.keywords),
        ai: linesOf(doc.ai),
        sticky: doc.sticky ?? undefined,
      },
      body: doc.content ?? '',
    }));
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
      // 与本地文件命名一致：日期作为唯一 id
      id: String(doc.date).slice(0, 10),
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
    if (label && href) out.push({ href, label })
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
      href: doc.href ?? undefined,
      articleHref: doc.articleHref ?? undefined,
      stars: Number(doc.stars ?? 0),
      tags: linesOf(doc.tags),
      sortOrder: Number(doc.sortOrder ?? 0),
    }));
}