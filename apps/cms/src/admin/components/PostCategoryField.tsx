'use client'
import { useEffect, useState } from 'react'
import { FieldError, FieldLabel, useField } from '@payloadcms/ui'

/**
 * 文章分类字段（单选，只能从系统已有分类中挑一个）
 *
 * 功能：
 * 1. 从 /api/categories 拉取系统里现有的分类，供下拉选择
 * 2. 用户只能选择，不能手填（避免出现不存在的分类）
 * 3. 选择后写入 relationship 字段（单个分类 id）
 *
 * @param props.path    Payload 字段路径
 * @param props.label   字段标签
 */
interface CategoryDoc {
  id: number
  name: string
  sort?: number | null
}

interface CategoryListResponse {
  docs: CategoryDoc[]
}

export const PostCategoryField: React.FC<{ path: string; label?: string }> = ({
  path,
  label,
}) => {
  // value / setValue 与 relationship 字段双向绑定
  const { value, setValue, showError, errorMessage } = useField({ path })

  const [categories, setCategories] = useState<CategoryDoc[]>([])
  const [loaded, setLoaded] = useState(false)

  // 挂载时拉取「可选分类」：只列节点类型=分类且前台可见的节点，按权重→名称排序
  useEffect(() => {
    const where = encodeURIComponent(
      JSON.stringify({ nodeType: { equals: 'category' }, visible: { not_equals: false } }),
    )
    fetch(`/api/categories?limit=0&sort=name&where=${where}`, {
      headers: { accept: 'application/json' },
    })
      .then((res) => res.json() as Promise<CategoryListResponse>)
      .then((json) => {
        const docs = Array.isArray(json?.docs) ? json.docs : []
        docs.sort((a, b) => (Number(a.sort ?? 0) - Number(b.sort ?? 0)) || a.name.localeCompare(b.name, 'zh'))
        setCategories(docs)
      })
      .catch(() => setCategories([]))
      .finally(() => setLoaded(true))
  }, [])

  /** 将 Payload 返回的 value（可能是 {id,name} 对象或裸 id）归一为字符串 id */
  const rawValue = value as unknown as { id?: number } | number | null | undefined
  const currentId =
    typeof rawValue === 'number'
      ? String(rawValue)
      : rawValue !== null && typeof rawValue === 'object'
        ? String(rawValue.id ?? '')
        : ''

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = Number(e.target.value)
    // 空字符串 = 清空；否则传数字 id
    setValue(nextId || null, true)
  }

  // 计算选中分类名（用于 URL 预览）
  const selected = categories.find((c) => String(c.id) === currentId)

  return (
    <div className="post-category-field">
      <FieldLabel htmlFor={path} label={label || '文章分类'} path={path} />
      <select
        id={path}
        className="post-category-field__select"
        value={currentId}
        onChange={onChange}
        disabled={!loaded}
      >
        <option value="">{loaded ? '请选择分类（必填）' : '加载中…'}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <p className="post-category-field__preview">
        {selected
          ? `文章将归入「${selected.name}」分类`
          : '必须先选择分类，才能确定文章链接'}
      </p>
      <FieldError message={errorMessage} showError={showError} />
    </div>
  )
}
