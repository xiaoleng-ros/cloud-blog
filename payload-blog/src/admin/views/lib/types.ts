/** 后台管理视图的 API 文档类型（与 Payload REST 响应对齐） */

/** POST + 分页响应 */
export interface ListResponse<T> {
  docs: T[]
  totalDocs: number
  page: number
  totalPages: number
}

/** Payload posts 文档（depth=1 展开关联对象或原始 id） */
export interface AdminPost {
  id: number
  title?: string | null
  slug?: string | null
  description?: string | null
  cover?: string | null
  categories?: Array<{ id: number; name: string } | number> | null
  tags?: Array<{ id: number; name: string } | number> | null
  keywords?: string | null
  ai?: string | null
  sticky?: number | null
  status?: 'draft' | 'published' | null
  content?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Payload notes 文档（depth=1 展开关联对象或原始 id） */
export interface AdminNote {
  id: number
  date?: string | null
  title?: string | null
  mood?: string | null
  tags?: Array<{ id: number; name: string } | number> | null
  status?: 'draft' | 'published' | null
  content?: string | null
  createdAt?: string
  updatedAt?: string
}

/** 分类 / 标签选项（发布弹窗、slug 下拉用） */
export interface TermOption {
  id: number
  name: string
}