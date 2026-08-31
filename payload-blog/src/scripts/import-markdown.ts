/**
 * 数据迁移脚本：将前台 cloud-blog 的 Markdown 内容导入 Payload 后台
 *
 * 功能：
 * 1. 递归扫描前台 src/content/posts 与 src/content/notes 下的 .md 文件
 * 2. 解析 frontmatter（gray-matter）
 * 3. 同步 分类/标签 → 文章/随笔，保持前台 id（文件相对路径）与后台 slug 一致
 * 4. 幂等：已存在的记录按 slug 更新，不重复创建
 *
 * 用法（在 payload-blog 目录下执行）：
 *   npm run import:data
 */
import 'dotenv/config'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { getPayload } from 'payload'
import config from '../payload.config'

/** 前台内容根目录（跨项目引用）：scripts → src → payload-blog → cloud → cloud-blog */
const CLOUD_BLOG_DIR = path.resolve(import.meta.dirname, '../../../cloud-blog')

/** 递归收集目录下所有 .md 文件，返回 [文件相对路径(去扩展名), 绝对路径] */
function collectMarkdown(dir: string, base: string): Array<[string, string]> {
  if (!existsSync(dir)) return []
  const results: Array<[string, string]> = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectMarkdown(full, base))
    } else if (entry.name.endsWith('.md')) {
      const id = path.relative(base, full).replace(/\\/g, '/').replace(/\.md$/, '')
      results.push([id, full])
    }
  }
  return results.sort((a, b) => a[0].localeCompare(b[0]))
}

/** 将数组字符串转换为「每行一个」的文本（与后台 keywords/ai 字段约定一致） */
function toLines(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const list = Array.isArray(value) ? value.map(String) : [String(value)]
  return list.join('\n')
}

async function main() {
  const payload = await getPayload({ config })

  console.log('📂 开始扫描前台 Markdown 文件…')
  const postFiles = collectMarkdown(
    path.join(CLOUD_BLOG_DIR, 'src/content/posts'),
    path.join(CLOUD_BLOG_DIR, 'src/content/posts'),
  )
  const noteFiles = collectMarkdown(
    path.join(CLOUD_BLOG_DIR, 'src/content/notes'),
    path.join(CLOUD_BLOG_DIR, 'src/content/notes'),
  )
  console.log(`  文章 ${postFiles.length} 篇，随笔 ${noteFiles.length} 篇`)

  // ---------- 1. 同步分类与标签 ----------
  const categoryNames = new Set<string>()
  const tagNames = new Set<string>()

  for (const [, file] of [...postFiles, ...noteFiles]) {
    const { data } = matter(readFileSync(file, 'utf-8'))
    const cats = Array.isArray(data.categories) ? data.categories : data.categories ? [data.categories] : []
    const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []
    cats.forEach((c: unknown) => c && categoryNames.add(String(c)))
    tags.forEach((t: unknown) => t && tagNames.add(String(t)))
  }

  /** 按名称查找或创建 分类/标签，返回其 id */
  const ensureTerms = async (collection: 'categories' | 'tags', names: Set<string>) => {
    const idMap = new Map<string, number>()
    for (const name of names) {
      const existing = await payload.find({
        collection,
        where: { name: { equals: name } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        idMap.set(name, existing.docs[0].id)
      } else {
        const created = await payload.create({
          collection,
          data: { name, slug: name },
        })
        idMap.set(name, created.id)
        console.log(`  新增${collection === 'categories' ? '分类' : '标签'}：${name}`)
      }
    }
    return idMap
  }
  const categoryIds = await ensureTerms('categories', categoryNames)
  const tagIds = await ensureTerms('tags', tagNames)
  console.log(`✅ 分类 ${categoryIds.size} 个，标签 ${tagIds.size} 个`)

  // ---------- 2. 同步文章 ----------
  for (const [id, file] of postFiles) {
    const { data, content } = matter(readFileSync(file, 'utf-8'))
    const categories = (Array.isArray(data.categories) ? data.categories : data.categories ? [data.categories] : [])
      .map((c: unknown) => categoryIds.get(String(c)))
      .filter(Boolean)
    const tags = (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [])
      .map((t: unknown) => tagIds.get(String(t)))
      .filter(Boolean)

    const docData = {
      title: String(data.title ?? id),
      slug: id,
      description: data.description ? String(data.description) : undefined,
      cover: data.cover ? String(data.cover) : undefined,
      categories: categories as number[],
      tags: tags as number[],
      keywords: toLines(data.keywords),
      ai: toLines(data.ai),
      sticky: data.sticky !== undefined && data.sticky !== null ? Number(data.sticky) : undefined,
      status: 'published',
      // 后台已无 date 字段：用 frontmatter 日期写入 createdAt，保持文章时间排序正确
      ...(data.date ? { createdAt: new Date(String(data.date)) } : {}),
      content: content,
    }

    const existing = await payload.find({
      collection: 'posts',
      where: { slug: { equals: id } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      // 更新时剥离 createdAt（Payload 会忽略该字段，且重导不应改写创建时间）
      const updateData = { ...docData }
      delete updateData.createdAt
      await payload.update({ collection: 'posts', id: existing.docs[0].id, data: updateData as never })
      console.log(`🔄 更新文章：${id}`)
    } else {
      await payload.create({ collection: 'posts', data: docData as never })
      console.log(`✅ 新建文章：${id}`)
    }
  }

  // ---------- 3. 同步随笔 ----------
  // 以「本地时区日期」作为幂等键（Payload 按 UTC 存储日期，直接用 ISO 前缀会因时区偏移不匹配）
  const localDateKey = (value: string | Date) => {
    const d = new Date(value)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  }

  const existingNotes = await payload.find({ collection: 'notes', limit: 0, sort: 'date' })
  const notesByDate = new Map<string, { id: number; date: string | Date }[]>()
  for (const note of existingNotes.docs) {
    const key = localDateKey(note.date as string | Date)
    notesByDate.set(key, [...(notesByDate.get(key) ?? []), { id: note.id, date: note.date as string | Date }])
  }

  // 清理历史重复记录（同日期只保留一条）
  for (const [key, list] of notesByDate) {
    if (list.length > 1) {
      const keep = list[0]
      for (const dup of list.slice(1)) {
        await payload.delete({ collection: 'notes', id: dup.id })
        console.log(`🧹 清理重复随笔：${key}`)
      }
      notesByDate.set(key, [keep])
    }
  }

  for (const [id, file] of noteFiles) {
    const { data, content } = matter(readFileSync(file, 'utf-8'))
    const tags = (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [])
      .map((t: unknown) => tagIds.get(String(t)))
      .filter(Boolean)

    // 日期必须转成 ISO 8601 字符串：SQLite 宽松接受 JS Date 的 toStr/格式，
    // 但 PostgreSQL 只认 ISO 格式，否则抛 "invalid input syntax for type timestamp"
    const noteDate =
      data.date instanceof Date ? data.date.toISOString() : String(data.date)

    const docData = {
      date: noteDate,
      title: data.title ? String(data.title) : undefined,
      mood: data.mood ? String(data.mood) : undefined,
      tags: tags as number[],
      // 随笔也支持草稿：从本地 md 导入的内容视为已发布
      status: 'published' as const,
      content: content,
    }

    // 随笔无 slug 字段，以「本地时区日期」作为幂等标识。
    // 注意：不能用 String(data.date) —— frontmatter 的 date 已被 gray-matter
    // 解析为 Date，String() 得到 "Thu Dec 20 ..." 而非 ISO，无法匹配数据库键。
    const key = localDateKey(data.date as string | Date)
    const existing = notesByDate.get(key) ?? []

    if (existing.length > 0) {
      await payload.update({ collection: 'notes', id: existing[0].id, data: docData })
      console.log(`🔄 更新随笔：${id}`)
    } else {
      await payload.create({ collection: 'notes', data: docData })
      console.log(`✅ 新建随笔：${id}`)
    }
  }

  // ---------- 4. 同步站点设置（Global 单例） ----------
  const siteConfigFile = path.join(CLOUD_BLOG_DIR, 'src/data/site.config.json')
  if (existsSync(siteConfigFile)) {
    const siteConfig = JSON.parse(readFileSync(siteConfigFile, 'utf-8'))
    let global = await payload.findGlobal({ slug: 'site-settings' })

    // 仅当对应区块为空时才写入默认值，避免覆盖后台已手动修改的内容
    const site = global?.siteName ? global : {
      siteName: siteConfig.siteName,
      siteDescription: siteConfig.siteDescription,
      siteAuthor: siteConfig.siteAuthor,
      githubUser: siteConfig.githubUser,
      githubRepo: siteConfig.githubRepo,
      twikooEnvId: siteConfig.twikooEnvId as string | undefined,
      neteasePlaylistId:
        (siteConfig.neteasePlaylistId as string | undefined) ??
        Number(siteConfig.neteasePlaylistId)?.toString(),
    }
    const hero = global?.name ? global : {
      greeting: '嗨，我是',
      name: '段枫',
      subtitle: '又名 DUAN FENG · 爱折腾的创作者',
      bio: '别人叫我「AI 实践者」，我觉得自己只是个爱画画、爱写代码的孩子。把屏幕当画板，把代码当蜡笔，在这里画了 {count} 篇笔记。',
      buttonLabel: '浏览文章',
    }
    // 社交链接：textarea 字符串（每行「平台 链接」）
    const socials =
      global?.socials && String(global.socials).trim()
        ? global.socials
        : [
            'bilibili https://space.bilibili.com/46377861',
            'douyin https://www.douyin.com/user/self',
            'youtube https://www.youtube.com/channel/UCUuwwXFGK8Z3OBrq6PzkmUg',
            'x https://x.com/shenfanlaogou',
            'rss /rss.xml',
          ].join('\n')

    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ...site, ...hero, socials },
    })

    // 导航已拆分到「导航管理」(navigation) Global
    const navGlobal = await payload.findGlobal({ slug: 'navigation' })
    const navItems =
      navGlobal?.navItems?.length
        ? navGlobal.navItems
        : [
            { href: '/', label: '首页' },
            { href: '/notes/', label: '随笔' },
            { href: '/archive/', label: '归档' },
            { href: '/about/', label: '关于' },
          ]
    await payload.updateGlobal({
      slug: 'navigation',
      data: { navItems: navItems as never },
    })

    console.log('✅ 站点设置已从 site.config.json 同步（含导航同步到导航管理）')
  }

  console.log('\n🎉 迁移完成')
  await payload.db.destroy()
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ 迁移失败：', err)
  process.exit(1)
})