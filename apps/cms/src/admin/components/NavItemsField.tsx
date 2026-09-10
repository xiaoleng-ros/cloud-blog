'use client'

/**
 * 自定义「导航项」字段组件
 *
 * 功能说明：
 * - 底层与社交链接一致：textarea 存储，每行一条「文字 链接」
 * - 渲染成可视化的卡片列表：文字输入框 + 链接输入框 + 删除按钮
 * - 支持一键添加、删除
 * - 文本持久化，刷新时初始值能正常回填（规避 array 字段自定义组件的初始值问题）
 */
import { FieldLabel, useField } from '@payloadcms/ui'
import React, { useCallback, useState } from 'react'

/** 单条导航项 */
interface NavItem {
  /** 导航文字 */
  label: string
  /** 跳转链接 */
  href: string
}

/**
 * 将后台存储的文本解析为结构化数组（宽松版）
 * - 兼容「有链接」和「无链接（编辑中的中间态）」两种行
 * - 无空格的行：整行视为文字，链接待填写
 * - 用最后一个空格切分，文字可含空格（链接为 URL 不含空格）
 * @param raw 每行「文字 链接」的字符串
 * @returns 结构化导航项数组
 */
function parseNavItems(raw?: string | null): NavItem[] {
  if (!raw) return []
  const out: NavItem[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.lastIndexOf(' ')
    // 无空格：整行视为文字，链接待填写
    if (sp === -1) {
      out.push({ label: trimmed, href: '' })
      continue
    }
    const label = trimmed.slice(0, sp).trim()
    const href = trimmed.slice(sp + 1).trim()
    if (label) out.push({ label, href })
  }
  return out
}

/**
 * 将结构化数组序列化为后台存储的文本
 * - 有链接写「文字 链接」，链接为空仅写文字（前台解析会忽略无链接项之外的行）
 * @param items 导航项数组
 * @returns 每行「文字 链接」的字符串
 */
function stringifyNavItems(items: NavItem[]): string {
  return items
    .filter((item) => item.label)
    .map((item) => (item.href.trim() ? `${item.label.trim()} ${item.href.trim()}` : item.label.trim()))
    .join('\n')
}

/**
 * 导航项自定义字段
 * @param props.path Payload 字段路径
 * @param props.label 字段标签
 */
export const NavItemsField: React.FC<{ path: string; label?: string }> = ({ path, label }) => {
  // 通过 Payload 的 useField 读写字段值（textarea 字符串）
  const { value, setValue } = useField<string>({ path })

  // 渲染与编辑以本地 state 为准（初始化自表单文本）。
  // 这样点击「添加」产生的空卡片能立即显示；序列化只影响保存时的字段值，不会反向吞掉空行。
  const [items, setItems] = useState<NavItem[]>(() => parseNavItems(value))

  /**
   * 更新某一项
   * @param index 目标索引
   * @param next 新的项数据
   */
  const updateItem = useCallback(
    (index: number, next: NavItem) => {
      const nextItems = items.map((item, i) => (i === index ? next : item))
      setItems(nextItems)
      setValue(stringifyNavItems(nextItems))
    },
    [items, setValue],
  )

  /**
   * 删除某一项
   * @param index 目标索引
   */
  const removeItem = useCallback(
    (index: number) => {
      const nextItems = items.filter((_, i) => i !== index)
      setItems(nextItems)
      setValue(stringifyNavItems(nextItems))
    },
    [items, setValue],
  )

  /**
   * 添加一条空导航项
   */
  const addItem = useCallback(() => {
    const nextItems = [...items, { label: '', href: '' }]
    setItems(nextItems)
    setValue(stringifyNavItems(nextItems))
  }, [items, setValue])

  return (
    <div className="field-type nav-items-field">
      {/* 字段标签 */}
      <FieldLabel htmlFor={path} label={label || '导航项'} path={path} />

      {/* 导航项卡片列表 */}
      <div className="nav-items-field__list">
        {items.length === 0 && (
          <div className="nav-items-field__empty">还没有导航项，点击下方按钮添加一条。</div>
        )}

        {items.map((item, index) => (
          <div className="nav-items-field__row" key={`${item.label}-${index}`}>
            {/* 文字输入框（略窄，强调导航文字） */}
            <input
              type="text"
              value={item.label}
              onChange={(e) => updateItem(index, { ...item, label: e.target.value })}
              placeholder="导航文字，如：首页"
              className="nav-items-field__label"
            />

            {/* 链接输入框 */}
            <input
              type="text"
              value={item.href}
              onChange={(e) => updateItem(index, { ...item, href: e.target.value })}
              placeholder="/ 或 /archive/"
              className="nav-items-field__input"
            />

            {/* 删除按钮 */}
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="nav-items-field__remove"
              aria-label="删除此导航项"
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* 添加按钮 */}
      <button type="button" onClick={addItem} className="nav-items-field__add">
        + 添加导航项
      </button>

      {/* 格式说明 */}
      <p className="nav-items-field__hint">
        每条为一个「文字 链接」，按从上到下顺序在前台顶部导航展示。链接支持相对路径（如{' '}
        <code>/archive/</code>）或完整网址。
      </p>
    </div>
  )
}