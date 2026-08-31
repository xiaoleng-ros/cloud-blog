'use client'
import { useEffect, useState } from 'react'
import { fetchTerms, type TermOption } from '../lib/api'

/**
 * slug 受控输入（分类下拉 + 标识输入 + 最终 URL 预览）
 *
 * @param props.value 当前 slug（如 技术/deploy-static，或仅标识）
 * @param props.onChange 组合后的完整 slug
 */
export const SlugInput: React.FC<{ value: string; onChange: (slug: string) => void }> = ({
  value,
  onChange,
}) => {
  // 把已有 slug 拆成「分类 / 标识」两部分（如 技术/deploy-static → 技术 + deploy-static）
  const split = (slug: string) => {
    const idx = slug.lastIndexOf('/')
    if (idx > 0) return { category: slug.slice(0, idx), base: slug.slice(idx + 1) }
    return { category: '', base: slug }
  }
  // 初始化拆解结果（仅在组件挂载时执行一次）
  const [category, setCategory] = useState(() => split(value ?? '').category)
  const [base, setBase] = useState(() => split(value ?? '').base)
  const [categories, setCategories] = useState<TermOption[]>([])
  const [loaded, setLoaded] = useState(false)

  // 挂载时拉取分类列表（后台同源已登录，携带 cookie 认证）
  useEffect(() => {
    fetchTerms('categories')
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setLoaded(true))
  }, [])

  /** 组合分类 + 标识为完整 slug（分类为空时仅返回标识） */
  const combine = (cat: string, b: string) => (cat ? `${cat}/${b}` : b)

  /** 选择分类后：更新本地 state 并回传完整 slug */
  const onCategory = (name: string) => {
    setCategory(name)
    onChange(combine(name, base))
  }

  /** 输入标识后：更新本地 state 并回传完整 slug */
  const onBase = (b: string) => {
    setBase(b)
    onChange(combine(category, b))
  }

  return (
    <div className="slug-input">
      <div className="slug-input__row">
        <select className="slug-input__select" value={category} onChange={(e) => onCategory(e.target.value)}>
          <option value="">（无分类）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="slug-input__slash">/</span>
        <input
          type="text"
          className="slug-input__input"
          placeholder="文章标识，如 deploy-static"
          value={base}
          onChange={(e) => onBase(e.target.value)}
        />
      </div>
      <p className="slug-input__preview">
        {loaded ? `最终 URL：/posts/${combine(category, base)}/` : '加载分类中…'}
      </p>
    </div>
  )
}

export default SlugInput