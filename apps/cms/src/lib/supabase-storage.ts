/**
 * Supabase Storage（S3 兼容层）配置的**唯一来源**。
 *
 * 谁在用：
 *   - `payload.config.ts` 的 s3Storage 插件（media 集合上传）
 *   - `app/api/comment-image/route.ts`（访客评论配图上传）
 *
 * 为什么单独抽出来：这两处必须看到完全一样的一套值。之前只在 payload.config 里推导，
 * 上传端点如果自己读 process.env，本地就会出现「media 能传、评论配图说没配置」，
 * 因为 SUPABASE_S3_ENDPOINT / SUPABASE_PUBLIC_BASE 通常不显式配，靠 project ref 拼出来。
 */
export type StorageConfig = {
  accessKeyId?: string
  secretAccessKey?: string
  bucket?: string
  /** S3 协议端点，形如 https://<ref>.supabase.co/storage/v1/s3（少 /s3 会命中 Kong 404） */
  endpoint?: string
  /** 公开读前缀，形如 https://<ref>.supabase.co/storage/v1/object/public */
  publicBase?: string
  /** 五项齐全才可上传；缺任何一项都视为未配置 */
  ready: boolean
}

/**
 * 从连接串推导 project ref。
 *
 * 两种连法要分开处理，这是踩过的坑：
 *   - 直连：`db.<ref>.supabase.co` → 主机名第一段就是 ref
 *   - **池化：`aws-0-<region>.pooler.supabase.com` → 主机名里根本没有 ref**，
 *     ref 挂在用户名上（`postgres.<ref>`）。照直连那样 split('.')[0] 会得到
 *     `aws-0-ap-northeast-1`，拼出 `aws-0-ap-northeast-1.supabase.co` 这种不存在的域名
 *     （实测 ENOTFOUND，和 2026-10-12 那次 ref 打错的表现一模一样）。
 *
 * 本地库指向 127.0.0.1 时两者都推不出来，必须显式配 SUPABASE_PROJECT_REF。
 */
function refFromPostgresUrl(): string | undefined {
  const raw = process.env.POSTGRES_URL
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    const host = url.hostname

    // 池化连接：ref 在用户名里（postgres.<ref>），主机名只有 region
    if (host.includes('.pooler.supabase.')) {
      const user = decodeURIComponent(url.username)
      const ref = user.includes('.') ? user.split('.')[1] : undefined
      return ref && PROJECT_REF_RE.test(ref) ? ref : undefined
    }

    if (host.endsWith('.supabase.co') || host.endsWith('.supabase.com')) {
      // 直连是 db.<ref>.supabase.co —— 首段是 "db"，ref 在第二段。
      // 早先写成 host.split('.')[0] 会推导出 "db"，拼出 https://db.supabase.co
      // 这种不存在的域名，症状和 ref 抄错一模一样（图片全挂 + 上传 404）。
      const labels = host.split('.')
      const candidate = labels[0] === 'db' ? labels[1] : labels[0]
      return candidate && PROJECT_REF_RE.test(candidate) ? candidate : undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Supabase project ref 的合法形状：20 位小写字母数字 */
const PROJECT_REF_RE = /^[a-z0-9]{20}$/i

/**
 * 从端点里抠出被写死的 project ref。
 *
 * 要覆盖两种线上真实出现过的形状，少写一种就漏掉一次事故：
 *   - `https://<ref>.supabase.co/...`          直连 API 域（常规）
 *   - `https://<ref>.storage.supabase.co/...`  **Storage 专用域**（控制台「Connect to S3」
 *     面板给的就是这个）。2026-10-21 线上配的正是后者，只匹配两段式会整段漏判。
 */
const REF_IN_URL_RE = /^(?:https?:\/\/)?([a-z0-9]{20})\.(?:storage\.)?supabase\.co(?=\/|:|$)/i

/**
 * 从 URL 里抠出 project ref（抠不出返回 undefined）。
 *
 * 供 /api/health 回显「实际生效的 ref」用 —— 与 alignRef 共用同一条正则，
 * 否则诊断端点会看不见 `.storage.` 形状，把事故藏起来。
 */
export function refFromUrl(url: string | undefined): string | undefined {
  const v = url?.trim()
  return v ? REF_IN_URL_RE.exec(v)?.[1] : undefined
}

function normalizeRef(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v && PROJECT_REF_RE.test(v) ? v : undefined
}

/**
 * 把显式配置的端点里写死的 `<ref>` 校正成权威 ref。
 *
 * 只认 `*.supabase.co` 与 `*.storage.supabase.co` 这两种首段；自定义域名 / CDN 前进
 * 原样返回，不做任何猜测（自建域名不该被改写）。
 */
function alignRef(value: string | undefined, ref: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v || !ref) return v || undefined
  const configured = REF_IN_URL_RE.exec(v)?.[1]
  if (!configured || configured === ref) return v
  console.warn(`[storage] 端点里写死的 project ref ${configured} 与权威 ref ${ref} 不一致，已按后者校正`)
  return v.replace(configured, ref)
}

export function resolveStorageConfig(): StorageConfig {
  const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY?.trim()
  const bucket = process.env.SUPABASE_BUCKET?.trim()

  /**
   * ref 的权威来源：**先看 POSTGRES_URL，再看 SUPABASE_PROJECT_REF**。
   *
   * 顺序曾经是反的，这是线上图片全挂的根因（2026-10-21）：控制台里的
   * SUPABASE_PROJECT_REF 抄成了 `jmnuamukepfauzdzmztn`（正解 `jmnuamukepfauzdzemtn`，
   * 第 17、18 位的 e/m 写成了 m/z），而 POSTGRES_URL 里的 ref 一直是对的
   * —— 否则数据库根本连不上、整站会直接 500。
   *
   * 「能连上库」本身就是 ref 正确的证明，不该让一个可能抄错的手填值覆盖它。
   * 数据库 URL 推得出 ref 时以它为准，手填值仅在推不出时兜底（本地 127.0.0.1 那种）。
   */
  const refFromDb = refFromPostgresUrl()
  const refFromEnv = normalizeRef(process.env.SUPABASE_PROJECT_REF)
  const ref = refFromDb ?? refFromEnv
  if (refFromDb && refFromEnv && refFromDb !== refFromEnv) {
    console.warn(
      `[storage] SUPABASE_PROJECT_REF=${refFromEnv} 与数据库连接串里的 ref=${refFromDb} 不一致，` +
        `已按后者（能与数据库建连的那个）为准，请修正环境变量。`,
    )
  }
  const host = ref ? `${ref}.supabase.co` : undefined

  const endpoint = alignRef(
    process.env.SUPABASE_S3_ENDPOINT || (host ? `https://${host}/storage/v1/s3` : undefined),
    ref,
  )
  const publicBase = alignRef(
    process.env.SUPABASE_PUBLIC_BASE || (host ? `https://${host}/storage/v1/object/public` : undefined),
    ref,
  )

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicBase,
    ready: Boolean(accessKeyId && secretAccessKey && bucket && endpoint && publicBase),
  }
}
