'use client'

/**
 * 自定义「社交链接」字段组件
 *
 * 功能说明：
 * - 把底层每行「平台 链接」的文本，渲染成可视化的卡片列表
 * - 每行提供：平台选择器 + URL 输入框 + 删除按钮
 * - 支持一键添加新链接、删除已有链接
 * - 序列化后仍然写回 textarea 字符串，保证前台 parseSocials 无需改动
 */
import { FieldLabel, useField } from '@payloadcms/ui'
import React, { useCallback, useMemo } from 'react'

/** 支持的社交平台（与前台 socialIconMap 保持一致） */
const PLATFORM_OPTIONS = [
  { value: 'bilibili', label: 'Bilibili', color: '#fb7299' },
  { value: 'douyin', label: '抖音', color: '#000000' },
  { value: 'youtube', label: 'YouTube', color: '#ff0000' },
  { value: 'x', label: 'X', color: '#0f1419' },
  { value: 'rss', label: 'RSS 订阅', color: '#f26522' },
] as const

/** 平台类型 */
type Platform = (typeof PLATFORM_OPTIONS)[number]['value']

/** 单条社交链接 */
interface SocialItem {
  /** 平台标识 */
  platform: Platform
  /** 链接地址 */
  href: string
}

/**
 * 将后台存储的文本解析为结构化数组（宽松版）
 * - 兼容「有链接」和「无链接（正在编辑的中间态）」两种行
 * - 无链接的行：整行就是一个平台名（如 bilibili），href 解析为空
 * - 出于健壮性：平台名不在选项表时也保留，避免编辑时意外丢失
 * @param raw 每行「平台 链接」的字符串
 * @returns 结构化社交链接数组
 */
function parseSocials(raw?: string | null): SocialItem[] {
  if (!raw) return []
  const out: SocialItem[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.indexOf(' ')
    // 无空格：整行视为平台名，链接待填写
    if (sp === -1) {
      out.push({ platform: trimmed as Platform, href: '' })
      continue
    }
    const platform = trimmed.slice(0, sp).trim() as Platform
    const href = trimmed.slice(sp + 1).trim()
    if (platform) out.push({ platform, href })
  }
  return out
}

/**
 * 将结构化数组序列化为后台存储的文本
 * - 有链接写「平台 链接」，链接为空仅写「平台」（前台解析会自动忽略该行）
 * @param items 社交链接数组
 * @returns 每行「平台 链接」的字符串
 */
function stringifySocials(items: SocialItem[]): string {
  return items
    .filter((item) => item.platform)
    .map((item) => (item.href.trim() ? `${item.platform} ${item.href.trim()}` : item.platform))
    .join('\n')
}

/**
 * 社交链接自定义字段
 * @param props.path Payload 字段路径
 * @param props.label 字段标签
 */
export const SocialLinksField: React.FC<{ path: string; label?: string }> = ({ path, label }) => {
  // 通过 Payload 的 useField 读写字段值
  const { value, setValue } = useField<string>({ path })

  // 将当前值解析为结构化列表
  const items = useMemo(() => parseSocials(value), [value])

  /**
   * 更新某一项
   * @param index 目标索引
   * @param next 新的项数据
   */
  const updateItem = useCallback(
    (index: number, next: SocialItem) => {
      const nextItems = items.map((item, i) => (i === index ? next : item))
      setValue(stringifySocials(nextItems))
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
      setValue(stringifySocials(nextItems))
    },
    [items, setValue],
  )

  /**
   * 添加一条空链接
   */
  const addItem = useCallback(() => {
    const nextItems = [...items, { platform: 'bilibili' as Platform, href: '' }]
    setValue(stringifySocials(nextItems))
  }, [items, setValue])

  return (
    <div className="field-type social-links-field">
      {/* 字段标签 */}
      <FieldLabel htmlFor={path} label={label || '社交链接'} path={path} />

      {/* 链接卡片列表 */}
      <div className="social-links-field__list">
        {items.length === 0 && (
          <div className="social-links-field__empty">还没有添加社交链接，点击下方按钮添加一条。</div>
        )}

        {items.map((item, index) => {
          const option = PLATFORM_OPTIONS.find((p) => p.value === item.platform) ?? PLATFORM_OPTIONS[0]
          return (
            <div className="social-links-field__row" key={`${item.platform}-${index}`}>
              {/* 平台选择器 */}
              <div className="social-links-field__platform">
                <span
                  className="social-links-field__dot"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
                <select
                  id={index === 0 ? path : undefined}
                  value={item.platform}
                  onChange={(e) => updateItem(index, { ...item, platform: e.target.value as Platform })}
                  className="social-links-field__select"
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* URL 输入框 */}
              <input
                type="text"
                value={item.href}
                onChange={(e) => updateItem(index, { ...item, href: e.target.value })}
                placeholder="https://..."
                className="social-links-field__input"
              />

              {/* 删除按钮 */}
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="social-links-field__remove"
                aria-label="删除此链接"
                title="删除"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/* 添加按钮 */}
      <button type="button" onClick={addItem} className="social-links-field__add">
        + 添加社交链接
      </button>

      {/* 格式说明 */}
      <p className="social-links-field__hint">
        每行保存为「平台 链接」格式，前台会自动匹配对应图标。支持 {PLATFORM_OPTIONS.map((p) => p.label).join(' / ')}。
      </p>
    </div>
  )
}
