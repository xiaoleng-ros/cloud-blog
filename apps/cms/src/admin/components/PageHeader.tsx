import type { ReactNode } from 'react'

/**
 * 统一页头：标题 + 可选右侧操作区
 * 样式在 admin-theme.css 的 .page-header 一节；页头本身就是一张卡片，
 * 与下方内容卡同宽同圆角，左右边缘由内容列的 --gutter 对齐顶栏标签条。
 */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        <h1 className="page-header__title">{title}</h1>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
