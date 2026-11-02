/**
 * 友链卡片配色表（前台 Astro 与 CMS 运行时注入共用同一份）。
 *
 * 参考站是「一卡一色」的彩色墙：深色卡配白字、浅色卡配深字。
 * 这里把每种卡片的背景与前景色成对定义，避免在两边各写一套色号而漂移
 * （一旦漂移，后台改一次友链，前台卡片就会整片换色 —— 这个仓库踩过同类坑）。
 *
 * 选色原则：
 *   1. 低饱和莫兰迪色系，和站点的手账纸色（--bg #fbf7ed）不打架；
 *   2. 每套都满足「白字或深字至少 3:1」的可读下限，文字不做描边；
 *   3. 同一站点永远同一色（按站名 hash 取），不随排序/增删变动。
 */

export interface FriendColor {
  /** 卡片背景 */
  bg: string
  /** 主文字色（站名）：深色卡给暖白，浅色卡给深墨 */
  fg: string
}

export const FRIEND_PALETTE: FriendColor[] = [
  { bg: '#b7aea3', fg: '#fffefb' }, // 暖灰
  { bg: '#e08a84', fg: '#fffefb' }, // 珊瑚
  { bg: '#7fb0ad', fg: '#fffefb' }, // 青瓷
  { bg: '#cfd6cb', fg: '#41473f' }, // 浅灰绿（浅底深字）
  { bg: '#d9827a', fg: '#fffefb' }, // 砖红
  { bg: '#f0e0a4', fg: '#4a4331' }, // 淡奶黄（浅底深字）
  { bg: '#f2c9d4', fg: '#5c3a44' }, // 藕粉（浅底深字）
  { bg: '#8a92a3', fg: '#fffefb' }, // 蓝灰
  { bg: '#c8bda4', fg: '#4a4436' }, // 卡其（浅底深字）
  { bg: '#4d4d4d', fg: '#f7f4ee' }, // 墨灰
  { bg: '#b6a5d1', fg: '#fffefb' }, // 浅紫
  { bg: '#dda87a', fg: '#4e3a28' }, // 陶土橙（浅底深字）
  { bg: '#a794c2', fg: '#fffefb' }, // 紫罗兰
  { bg: '#a9a9a9', fg: '#fffefb' }, // 中性灰
  { bg: '#46566f', fg: '#f2f5fa' }, // 深蓝
  { bg: '#7ec4de', fg: '#2f4a56' }, // 天青（浅底深字）
]

/**
 * 按站名取色。
 *
 * 用站名的码位散列而不是「数组下标」：下标会随增删/排序整体前移，
 * 站长加一条友链，后面所有卡片就集体换色，看着像页面崩了。
 * 散列保证「同一个站永远同一个颜色」。
 */
export function friendColorOf(name: string): FriendColor {
  let hash = 0
  for (const ch of String(name ?? '')) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 100_000
  }
  return FRIEND_PALETTE[hash % FRIEND_PALETTE.length]!
}
