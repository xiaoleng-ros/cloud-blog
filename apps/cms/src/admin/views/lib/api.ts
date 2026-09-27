/** 后台管理视图的 REST 辅助函数
 *
 * 说明：
 * 1. 全部走同源相对路径 /api/*，登录后由 cookie 会话认证
 * 2. 失败时抛出带错误信息的 ApiError，便于视图层根据 status 做差异化提示
 */
import type { ListResponse, TermOption } from './types'
// 重新导出类型，供各视图统一从 api 模块引入
export type { ListResponse, TermOption, AdminPost, AdminNote } from './types'

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

/** 分页拉取列表（带 where 过滤与排序；depth=1 展开关联） */
export async function listDocs<T>(
  collection: 'posts' | 'notes',
  where: Record<string, unknown>,
  page = 1,
  size = 10,
  sort = '-updatedAt',
): Promise<ListResponse<T>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(size),
    sort,
    depth: '1',
    where: JSON.stringify(where),
  })
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

/** 拉取分类 / 标签全量列表（用于下拉选择） */
export async function fetchTerms(collection: 'categories' | 'tags'): Promise<TermOption[]> {
  const res = await request<ListResponse<TermOption>>(
    'GET',
    `/api/${collection}?limit=0&depth=0&sort=createdAt`,
  )
  return res.docs
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