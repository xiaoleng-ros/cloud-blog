/** 后台管理视图的 API 文档类型（与 Payload REST 响应对齐） */

/** POST + 分页响应 */
export interface ListResponse<T> {
  docs: T[]
  totalDocs: number
  page: number
  totalPages: number
}

/**
 * Payload posts 文档
 *
 * 关系字段形态：categories 现在是「单选必填」（无 hasMany），
 * depth=1 时会展开为单个对象 `{ id, name }`，depth=0 时为裸 id。
 * 兼容两种形态，避免前端解构报错。
 */
export interface AdminPost {
  id: number
  title?: string | null
  description?: string | null
  cover?: string | null
  categories?: Array<{ id: number; name: string } | number> | { id: number; name: string } | number | null
  tags?: Array<{ id: number; name: string } | number> | null
  keywords?: string | null
  ai?: string | null
  sticky?: number | null
  status?: 'draft' | 'published' | null
  content?: string | null
  deletedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Payload notes 文档（含新增的单选 categories 关系） */
export interface AdminNote {
  id: number
  date?: string | null
  title?: string | null
  mood?: string | null
  categories?: Array<{ id: number; name: string } | number> | { id: number; name: string } | number | null
  tags?: Array<{ id: number; name: string } | number> | null
  status?: 'draft' | 'published' | null
  content?: string | null
  deletedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

/** 分类 / 标签选项（发布弹窗、下拉用） */
export interface TermOption {
  id: number
  name: string
}

/** 分类完整文档（分类管理树视图用，含层级/类型/权重/可见性） */
export interface CategoryDoc {
  id: number
  name: string
  slug?: string | null
  nodeType?: 'category' | 'page' | 'nav' | null
  /** depth=0 时关系字段为裸 id 或 null */
  parent?: number | { id: number } | null
  sort?: number | null
  visible?: boolean | null
  createdAt?: string
  updatedAt?: string
}
