/**
 * 通用创作页的纯函数与常量（从 ComposeView.tsx 抽出，便于单测）
 *
 * 抽取原则：
 * 1. 不依赖 React / DOM / 全局对象，输入输出确定；
 * 2. 全部导出，供 ComposeView 使用，也可被 vitest 直接断言。
 */

/** 草稿默认标题（`草稿 YYYY-MM-DD HH:MM`），与 Ice_blog 命名保持一致 */
export const defaultDraftTitle = (): string => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `草稿 ${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`
}

/**
 * 从 categories 字段取值（Payload depth=1 时可能是 {id,name} 对象，也可能是裸 id）
 *
 * 兼容三种形态：
 *   1. [{ id: 1, name: '技术' }]  关系展开为对象（depth=1 常见）
 *   2. [1]                         裸 id（depth=0 或未展开）
 *   3. { id: 1, name: '技术' } / 1  单值形态（关系字段无 hasMany 时）
 *
 * @param categories 原始字段值
 * @returns 分类 id 数组（无值返回空数组）
 */
export const idsOf = (
  categories?: Array<{ id: number; name: string } | number> | { id: number; name: string } | number | null,
): number[] => {
  if (!categories) return []
  if (Array.isArray(categories)) {
    return categories.map((c) => (typeof c === 'object' && c !== null ? Number(c.id) : Number(c)))
  }
  if (typeof categories === 'object') return [Number(categories.id)]
  return [Number(categories)]
}

/** 提交数据所需的字段集合（posts / notes 共用，各 collection 内按需取用） */
export interface ComposeFields {
  title: string
  description: string
  cover: string
  sticky: number
  mood: string
  date: string
  categoryIds: number[]
  tagIds: number[]
  content: string
  status: 'draft' | 'published'
}

/**
 * 组装提交数据
 *
 * posts / notes 现在都以「单选必填的 categories 关系」+ 数据库自增 id 生成 URL，
 * 因此提交体里不再带 slug，categories 传单个 id（关系字段的正确载荷形态）。
 */
export const buildPayload = (
  collection: 'posts' | 'notes',
  s: ComposeFields,
): Record<string, unknown> => {
  // 关系字段是单选，取第一个 id；空数组时传 undefined，让后端必填校验报错
  const firstCategory = s.categoryIds[0]
  return collection === 'posts'
    ? {
        title: s.title,
        description: s.description,
        cover: s.cover,
        sticky: s.sticky,
        categories: firstCategory,
        tags: s.tagIds,
        content: s.content,
        status: s.status,
      }
    : {
        title: s.title || undefined,
        mood: s.mood,
        date: s.date,
        categories: firstCategory,
        tags: s.tagIds,
        content: s.content,
        status: s.status,
      }
}
