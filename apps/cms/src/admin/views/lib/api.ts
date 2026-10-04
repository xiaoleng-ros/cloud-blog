/** 后台管理视图的 REST 辅助函数
 *
 * 说明：
 * 1. 全部走同源相对路径 /api/*，登录后由 cookie 会话认证
 * 2. 失败时抛出带错误信息的 ApiError，便于视图层根据 status 做差异化提示
 */
import type { CategoryDoc, ListResponse, TermOption } from './types'
// 重新导出类型，供各视图统一从 api 模块引入
export type { ListResponse, TermOption, AdminPost, AdminNote, CategoryDoc } from './types'

/**
 * 带 HTTP 状态码的错误对象
 *
 * 目的：让视图层（如 saveDraft）能识别 401/403 等认证/授权类失败，
 *      给出「登录已过期，请重新登录」这类明确文案，避免用户误以为内容丢失。
 *
 * @param message 展示给用户的错误信息（已尽量从后端 json.errors[0].message 提取）
 * @param status  HTTP 状态码（200 之外才是错误路径）
 * @param isRetryable 调用方可否安全重试（网络抖动类为 true；401/403/4xx 为 false）
 */
export class ApiError extends Error {
  status: number
  isRetryable: boolean

  constructor(message: string, status: number, isRetryable: boolean) {
    // Error 原型链需手动设置，`instanceof ApiError` 才能生效
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isRetryable = isRetryable
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/**
 * 把 ApiError 映射成给用户看的中文提示。
 * 401/403 必须给「重新登录/授权」类明确文案，避免用户误以为数据丢失；
 * 5xx 与网络抖动统一通用文案，不回显原始状态码。
 */
export const describeApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已过期，请重新登录后再操作'
    if (error.status === 403) return '无操作权限，请确认当前账号是否已授权'
    if (error.status === 429) return '操作过于频繁，请稍后重试'
    if (error.status >= 500) return '操作失败，请稍后重试'
    // 其余 4xx（含后端 APIError 抛出的中文业务提示）保留展示
    return error.message
  }
  return '操作失败，请稍后重试'
}

/** 基础 JSON 请求（支持 GET/POST/PATCH/DELETE） */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as { errors?: Array<{ message?: string }> }
      if (json.errors?.length && json.errors[0]?.message) message = json.errors[0].message
    } catch {
      // 忽略响应体解析失败，保留 HTTP 状态码
    }
    // 网络/服务端错误（5xx）视为可重试；4xx（业务/权限）不可重试
    const isRetryable = res.status >= 500
    throw new ApiError(message, res.status, isRetryable)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** 分页拉取列表（带 where 过滤与排序；depth=1 展开关联；trash=true 时结果包含回收站文档） */
export async function listDocs<T>(
  collection: 'posts' | 'notes',
  where: Record<string, unknown>,
  page = 1,
  size = 10,
  sort = '-updatedAt',
  trash = false,
): Promise<ListResponse<T>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(size),
    sort,
    depth: '1',
    where: JSON.stringify(where),
  })
  if (trash) query.set('trash', 'true')
  return request<ListResponse<T>>('GET', `/api/${collection}?${query.toString()}`)
}

/** 拉取单个文档（depth=1 展开关联） */
export async function getDoc<T>(collection: 'posts' | 'notes', id: number | string): Promise<T> {
  return request<T>('GET', `/api/${collection}/${id}?depth=1`)
}

/** 新建文档（响应含新文档与 id） */
export async function createDoc<T>(collection: 'posts' | 'notes', data: Record<string, unknown>): Promise<T> {
  return request<T>('POST', `/api/${collection}`, data)
}

/** 更新文档 */
export async function updateDoc<T>(
  collection: 'posts' | 'notes',
  id: number | string,
  data: Record<string, unknown>,
): Promise<T> {
  return request<T>('PATCH', `/api/${collection}/${id}`, data)
}

/** 删除文档 */
export async function deleteDoc(collection: 'posts' | 'notes', id: number | string): Promise<void> {
  await request<unknown>('DELETE', `/api/${collection}/${id}`)
}

/**
 * 移入回收站（软删除）
 *
 * Payload trash 机制：PATCH deletedAt 即标记删除；权限按 delete 校验。
 * 标记后该文档对所有默认查询（前台同步、列表、草稿箱）不可见。
 */
export async function trashDoc(collection: 'posts' | 'notes', id: number | string): Promise<void> {
  await request<unknown>('PATCH', `/api/${collection}/${id}`, { deletedAt: new Date().toISOString() })
}

/** 从回收站恢复：清空 deletedAt。必须带 ?trash=true，否则后端查询排除已删文档导致 404 */
export async function restoreDoc(collection: 'posts' | 'notes', id: number | string): Promise<void> {
  await request<unknown>('PATCH', `/api/${collection}/${id}?trash=true`, { deletedAt: null })
}

/** 彻底删除回收站中的文档（硬删）。同样需要 ?trash=true 定位已删文档 */
export async function deleteTrashedDoc(collection: 'posts' | 'notes', id: number | string): Promise<void> {
  await request<unknown>('DELETE', `/api/${collection}/${id}?trash=true`)
}

/** 拉取分类 / 标签全量列表（用于下拉选择） */
export async function fetchTerms(collection: 'categories' | 'tags'): Promise<TermOption[]> {
  const res = await request<ListResponse<TermOption>>(
    'GET',
    `/api/${collection}?limit=0&depth=0&sort=createdAt`,
  )
  return res.docs
}

/** 新建分类 / 标签（导入时按名称匹配不到标签则自动补建） */
export async function createTerm(collection: 'categories' | 'tags', name: string): Promise<TermOption> {
  return request<TermOption>('POST', `/api/${collection}`, { name })
}

/** 「可选分类」下拉专用：只列节点类型=分类 且 前台可见 的节点，按权重排序 */
export async function fetchSelectableCategories(): Promise<TermOption[]> {
  const where = { nodeType: { equals: 'category' }, visible: { not_equals: false } }
  const res = await request<ListResponse<TermOption>>(
    'GET',
    `/api/categories?limit=0&depth=0&sort=sort&where=${encodeURIComponent(JSON.stringify(where))}`,
  )
  return res.docs
}

/** 分类管理树视图：全量拉取（depth=0，parent 为裸 id） */
export async function listCategoryDocs(): Promise<CategoryDoc[]> {
  const res = await request<ListResponse<CategoryDoc>>(
    'GET',
    '/api/categories?limit=0&depth=0&sort=sort',
  )
  return res.docs
}

/** 新建分类（弹窗提交，字段见 Collections/Categories.ts） */
export async function createCategory(data: Record<string, unknown>): Promise<CategoryDoc> {
  return request<CategoryDoc>('POST', '/api/categories', data)
}

/** 更新分类 */
export async function updateCategory(id: number, data: Record<string, unknown>): Promise<CategoryDoc> {
  return request<CategoryDoc>('PATCH', `/api/categories/${id}`, data)
}

/** 删除分类（被引用 / 有子分类时后端 beforeDelete 会抛可读错误） */
export async function deleteCategory(id: number): Promise<void> {
  await request<unknown>('DELETE', `/api/categories/${id}`)
}

/** 更新标签（标签管理页改名） */
export async function updateTag(id: number, data: Record<string, unknown>): Promise<TermOption> {
  return request<TermOption>('PATCH', `/api/tags/${id}`, data)
}

/** 删除标签。hasMany 关联存在中间表（ON DELETE cascade），删除后自动从文章/随笔上移除 */
export async function deleteTag(id: number): Promise<void> {
  await request<unknown>('DELETE', `/api/tags/${id}`)
}

/** 统计每个标签被多少文章/随笔引用（标签管理「关联文章」列） */
export async function fetchTagUsage(): Promise<Record<number, number>> {
  const [posts, notes] = await Promise.all([
    request<ListResponse<{ tags?: Array<{ id: number } | number> | { id: number } | number | null }>>(
      'GET',
      '/api/posts?limit=0&depth=0&select[tags]=1',
    ),
    request<ListResponse<{ tags?: Array<{ id: number } | number> | { id: number } | number | null }>>(
      'GET',
      '/api/notes?limit=0&depth=0&select[tags]=1',
    ),
  ])
  const usage: Record<number, number> = {}
  for (const docs of [posts.docs, notes.docs]) {
    for (const d of docs) {
      for (const id of idsOf(d.tags)) usage[id] = (usage[id] ?? 0) + 1
    }
  }
  return usage
}

/**
 * 规范化关系字段为 id 数组
 *
 * 兼容三种形态：
 *   1. 数组（hasMany 关系，含展开对象或裸 id）
 *   2. 单个对象 `{ id, name }`（单选关系 depth=1）
 *   3. 裸 id（单选关系 depth=0）
 */
export function idsOf(
  refs?: Array<{ id: number } | number> | { id: number } | number | null,
): number[] {
  if (!refs) return []
  if (Array.isArray(refs)) {
    return refs.map((r) => (typeof r === 'object' ? Number(r.id) : Number(r)))
  }
  if (typeof refs === 'object') return [Number(refs.id)]
  return [Number(refs)]
}
/** 读取全局配置单例（globals 的 REST 前缀是 /api/globals，与集合不同） */
export async function fetchGlobal<T>(slug: string): Promise<T> {
  return request<T>('GET', `/api/globals/${slug}`)
}

/**
 * 保存全局配置单例
 * 注意：Payload 3 的 globals REST 更新端点是 POST /（见 payload/dist/globals/endpoints/index.js），
 * 不存在 PATCH/PUT 路由，发 PATCH 会被 handleEndpoints 返回 404 Route not found。
 * 且该端点把文档包在 { message, result } 里返回（与 GET 直接返回文档不同），
 * 这里统一解包成文档本体，避免调用方拿不到 updatedAt 而误判并发冲突。
 */
export async function updateGlobal<T>(slug: string, data: Record<string, unknown>): Promise<T> {
  const res = await request<{ message?: string; result?: T } | T>('POST', `/api/globals/${slug}`, data)
  if (res && typeof res === 'object' && 'result' in res) return (res as { result: T }).result
  return res as T
}
