/**
 * 评论敏感词表 —— 命中即被自动标为 spam（不进公开评论列表，只在后台可见，审核时可放行）。
 *
 * 【怎么加词】把词写进下面的 RAW 模板字符串，换行 / 空格 / 中英文逗号 / 顿号 / 分号分隔都行，
 *   一次贴几百上千个词都没问题（词库整段复制粘贴进来即可）。
 *   ⚠️ 词本身不要包含空格和逗号（会被当成分隔符）。
 *
 * 【匹配规则】大小写不敏感的子串匹配：评论正文里出现「加微信」三个字就命中，不需要整句相等。
 *
 * 【和环境变量的关系】与 EdgeOne 环境变量 FORBIDDEN_WORDS 取并集，两边写的词都生效；
 *   词很多时建议直接填在这里（环境变量有长度与字符限制，词表没有）。
 *
 * 【生效原理】waline-bridge 在启动 Waline 之前把词表合并进 process.env.FORBIDDEN_WORDS，
 *   @waline/vercel 的 config.js 在 require 时一次性读取它，@waline/core 对评论内容做
 *   正则匹配（dist/index.js：`new RegExp('(词1|词2)', 'iu').test(rawComment) → status='spam'`）。
 *   因为是拼进正则的，词表在这里统一做了正则转义，词里带 ( ) + . 之类字符也不会炸。
 */

const RAW = `
加微信,加V,vx,v加,加我,扫码,二维码,私聊
代购,刷单,兼职,日赚,躺赚,引流,推广,广告
贷款,网贷,套现,发票,办证,学历提升,招生
博彩,赌博,彩票,棋牌,网投,菠菜
色情,约炮,代孕,私服,外挂,代练
优惠券,返利,免费领,点击链接,加群,拉群
wechat,whatsapp,telegram,wxid_
`

/** 按空白 / 中英文逗号 / 顿号 / 分号切成词数组，去空、去重 */
function splitWords(raw: string): string[] {
  const words = raw
    .split(/[\s,，、;；]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
  return [...new Set(words)]
}

/** 转义正则元字符，让词能安全地被 Waline 拼进 `(词1|词2)` 正则 */
export function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 词表原文（未转义，用于去重与展示） */
export const forbiddenWordList: string[] = splitWords(RAW)
