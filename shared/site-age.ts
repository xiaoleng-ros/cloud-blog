/**
 * 站点运行时长：起始日期 → 总天数 + 年月日拆分。
 *
 * 日历口径固定 Asia/Shanghai（与 formatDate / toShanghaiParts 同一条线），
 * 否则构建机时区一换，天数就会差一天。
 */
import { toShanghaiParts } from './post-utils';

const DAY_MS = 86_400_000;

export interface SiteAge {
  /** 起始日到今天跨过的日历天数（起始当天算第 0 天） */
  totalDays: number;
  years: number;
  months: number;
  days: number;
}

/** 该时刻在 Asia/Shanghai 落在哪一个日历日（用日期序号表示，避免时区与夏令时干扰） */
function dayIndex(at: Date): number | undefined {
  const parts = toShanghaiParts(at);
  if (!parts) return undefined;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS;
}

/**
 * @param since 起始日期，接受 ISO 串 / 时间戳 / Date；后台字段是自由文本，解析不出来就返回 null
 * @param now   比较基准，默认当前时刻
 */
export function siteAge(since?: string | number | Date | null, now = new Date()): SiteAge | null {
  if (since === undefined || since === null || since === '') return null;
  const start = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(start.getTime())) return null;

  const from = dayIndex(start);
  const to = dayIndex(now);
  if (from === undefined || to === undefined || to < from) return null;

  const s = toShanghaiParts(start)!;
  const t = toShanghaiParts(now)!;
  const [sy, sm, sd] = [Number(s.year), Number(s.month), Number(s.day)];
  const [ty, tm, td] = [Number(t.year), Number(t.month), Number(t.day)];

  // 先数整月：没到「当月几号」就不算满这个月。
  const wholeMonths = (ty - sy) * 12 + (tm - sm) - (td < sd ? 1 : 0);
  const years = Math.floor(wholeMonths / 12);
  const months = wholeMonths % 12;
  // 整月推进到的锚点日：目标月没有这一天就夹到月末（1/31 → 2 月取 28）
  const anchor = sy * 12 + (sm - 1) + wholeMonths;
  const ay = Math.floor(anchor / 12);
  const am = anchor % 12;
  const anchorDay = Math.min(sd, new Date(Date.UTC(ay, am + 1, 0)).getUTCDate());
  const days = to - (Date.UTC(ay, am, anchorDay) / DAY_MS);

  return { totalDays: to - from, years, months, days };
}
