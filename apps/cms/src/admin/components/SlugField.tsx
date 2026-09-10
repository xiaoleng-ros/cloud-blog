'use client'
import { useEffect, useState } from 'react'
import { FieldError, FieldLabel, useField } from '@payloadcms/ui'

/** 分类文档（/api/categories 返回的浅结构） */
interface CategoryDoc {
  id: number
  name: string
  slug?: string | null
}

/** API 列表响应 */
interface CategoryListResponse {
  docs: CategoryDoc[]
}

/**
 * 文章标识（slug）自定义字段
 *
 * 功能：
 * 1. 自动从后台加载已有分类列表，供下拉选择（而不是手填 URL 前缀）
 * 2. 配合「标识」输入框，组合成完整 slug：分类/标识（无分类时仅标识）
 * 3. 实时预览最终写入的 slug 值，与前台 /posts/{slug}/ 路径保持一致
 *
 * @param props.path Payload 字段路径
 * @param props.label 字段标签
 */
export const SlugField: React.FC<{ path: string; label?: string }> = ({ path, label }) => {
  // value / setValue 与表单的 slug 字段双向绑定
  const { value, setValue, showError, errorMessage } = useField<string>({ path })

  /** 把已有 slug 拆成「分类 / 标识」两部分（如 技术/deploy-static → 技术 + deploy-static） */
  const splitSlug = (slug: string) => {
    const idx = slug.lastIndexOf('/')
    if (idx > 0) {
      return { category: slug.slice(0, idx), base: slug.slice(idx + 1) }
    }
    return { category: '', base: slug }
  }

  // 初始化拆解结果（仅在组件挂载时执行一次）
  const [category, setCategory] = useState(() => splitSlug(String(value ?? '')).category)
  const [base, setBase] = useState(() => splitSlug(String(value ?? '')).base)
  const [categories, setCategories] = useState<CategoryDoc[]>([])
  const [loaded, setLoaded] = useState(false)

  /** 组合分类 + 标识为完整 slug（分类为空时仅返回标识） */
  const combine = (cat: string, b: string) => (cat ? `${cat}/${b}` : b)

  // 挂载时拉取分类列表（后台同源已登录，携带 cookie 认证）
  useEffect(() => {
    fetch('/api/categories?limit=0&sort=createdAt', {
      headers: { accept: 'application/json' },
    })
      .then((res) => res.json() as Promise<CategoryListResponse>)
      .then((json) => setCategories(Array.isArray(json?.docs) ? json.docs : []))
      .catch(() => setCategories([]))
      .finally(() => setLoaded(true))
  }, [])

  /** 选择分类后：更新本地 state 并写入完整 slug */
  const onCategory = (name: string) => {
    setCategory(name)
    setValue(combine(name, base), true)
  }

  /** 输入标识后：更新本地 state 并写入完整 slug */
  const onBase = (b: string) => {
    setBase(b)
    setValue(combine(category, b), true)
  }

  return (
    <div className="slug-field">
      <FieldLabel htmlFor={path} label={label || '文章标识（URL 用）'} path={path} />
      <div className="slug-field__row">
        <select
          id={path}
          className="slug-field__select"
          value={category}
          onChange={(e) => onCategory(e.target.value)}
        >
          <option value="">（无分类）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="slug-field__slash">/</span>
        <input
          type="text"
          className="slug-field__input"
          placeholder="文章标识，如 deploy-static"
          value={base}
          onChange={(e) => onBase(e.target.value)}
        />
      </div>
      <p className="slug-field__preview">
        {loaded ? `最终 URL：/posts/${combine(category, base)}/` : '加载分类中…'}
      </p>
      <FieldError message={errorMessage} showError={showError} />
    </div>
  )
}