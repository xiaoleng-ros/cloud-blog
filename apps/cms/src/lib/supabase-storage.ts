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
      return ref && /^[a-z0-9]{20}$/i.test(ref) ? ref : undefined
    }

    if (host.endsWith('.supabase.co') || host.endsWith('.supabase.com')) {
      return host.split('.')[0]
    }
  } catch {
    return undefined
  }
  return undefined
}

export function resolveStorageConfig(): StorageConfig {
  const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY
  const bucket = process.env.SUPABASE_BUCKET

  const ref = process.env.SUPABASE_PROJECT_REF || refFromPostgresUrl()
  const host = ref ? `${ref}.supabase.co` : undefined

  const endpoint = process.env.SUPABASE_S3_ENDPOINT || (host ? `https://${host}/storage/v1/s3` : undefined)
  const publicBase =
    process.env.SUPABASE_PUBLIC_BASE || (host ? `https://${host}/storage/v1/object/public` : undefined)

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicBase,
    ready: Boolean(accessKeyId && secretAccessKey && bucket && endpoint && publicBase),
  }
}
