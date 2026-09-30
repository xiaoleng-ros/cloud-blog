import type { ReactNode } from 'react'

/**
 * 统一页头：eyebrow（英文小标）+ 标题 + 可选描述 + 可选右侧操作区
 * 样式在 admin-theme.css 的 .page-header 一节，底部细线与内容分隔。
 */
export function PageHeader({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow?: string
  title: string
  desc?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {desc && <p className="page-header__desc">{desc}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
