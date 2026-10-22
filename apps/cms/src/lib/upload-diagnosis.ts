/**
 * 把存储自检结果翻译成一句「下一步该做什么」。
 *
 * 单独成文件而不是塞在 route.ts 里，是为了能被单独编译、单独跑用例：
 * 这段逻辑曾经因为「取错了哪个字段的错误文本」而永远落到兜底分支，
 * 白白浪费了一轮排查（线上明明有 `SignatureDoesNotMatch`，提示却只说
 * 「见下方 error 字段」）。判读规则必须可测，否则它自己就会变成故障的一部分。
 *
 * 只用 `import type`，运行时零依赖，编译产物可直接丢给 Node 跑断言。
 */
import type { StorageSelfTestResult } from './storage-selftest'

export function diagnose(result: StorageSelfTestResult): string {
  // 先看「同一含义的变量存在多条」。注意不能简单地数 SUPABASE_S3_* 的条数：
  // ACCESS_KEY_ID / SECRET_ACCESS_KEY / ENDPOINT 本来就是三条不同的变量。
  // 正确做法是把名字归一化（去空白 + 转大写）后分组，组内多于一条才是重复——
  // 于是 `SUPABASE_S3_SECRET_ACCESS_KEY `（尾随空格）与
  // `supabase_s3_secret_access_key`（小写）都会与标准名字归成同一组，一次抓全。
  //
  // 这一步必须排在「名字不合法」之前：小写的变量名同时满足两条判据，而
  // 「同类变量有两条，代码读的是旧那条」比「名字写法不规范」更接近真正的病因。
  const groups = new Map<string, Array<{ name: string; valueLength: number }>>()
  for (const e of result.envNames) {
    const key = e.name.trim().toUpperCase()
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }
  const dupes = [...groups.values()].filter((arr) => arr.length > 1).flat()
  if (dupes.length) {
    return (
      `运行时能看到名字重复的变量：${dupes.map((e) => `${JSON.stringify(e.name)}（${e.valueLength} 位）`).join('、')} —— ` +
      `同一含义的变量存在多条时，代码只会读到其中一条（通常是旧的那条），所以改了值也毫无变化。` +
      `请删掉多余的那些，只保留标准大写写法。`
    )
  }
  // 名字带空白或非全大写，但又不构成重复 → 说明这条变量多半根本没人读，
  // 真正被读的那条可能已经没了。仍然值得先修名字。
  const badNames = result.envNames.filter((e) => e.suspicious)
  if (badNames.length) {
    return (
      `环境变量名不合法：${badNames.map((e) => JSON.stringify(e.name)).join('、')} —— ` +
      `名字里多了空白或大小写不对，平台会把它当成另一个变量，代码读的仍是原来那条，` +
      `所以改了值也毫无变化。请删掉这些名字，只保留标准大写写法。`
    )
  }
  const dirty = result.credentialHygiene.filter((h) => h.changed).map((h) => h.name)
  if (dirty.length) {
    return (
      `环境变量 ${dirty.join(' / ')} 带有多余的引号或空白（归一化已自动纠正，` +
      `本次上传可能已恢复正常）。建议去 EdgeOne 控制台清掉这些字符，避免下次换环境再踩。`
    )
  }
  if (result.headBucket.ok && result.putObject.ok) return '四段链路全部通过，图片上传应当正常。'

  // 判读必须优先用 putObject 那段的错误文本。
  // Supabase 对 HEAD（headBucket）的无效签名统一回 `Unknown http=403 UnknownError`，
  // 错误名里不带任何可判读信息；真正的 `SignatureDoesNotMatch` /
  // `InvalidAccessKeyId` 只出现在 putObject 的响应体里。早先这里取的是
  // `headBucket.ok ? putObject : headBucket`（「哪个步骤失败了」的逻辑，不是
  // 「哪段错误有信息量」的逻辑），结果只要 headBucket 失败就永远落到兜底那句。
  const text = [
    result.putObject.error,
    result.headBucket.error,
    result.putObject.code,
    result.headBucket.code,
  ]
    .filter(Boolean)
    .join(' ')

  if (/SignatureDoesNotMatch/i.test(text)) {
    const c = result.config
    // 最隐蔽也最常见的一种：两个环境变量填成了同一个值。
    // 指纹相同 ⇒ secret 里存的其实就是 accessKeyId（典型是复制串行，把上面那栏
    // 又粘了一遍）。此时长度必然也错（32 而非 64），但只说「长度不对」会让人
    // 以为是被截断，跑去重新复制同一栏 —— 必须明确指出来是填错了框。
    if (c.secretsMatch) {
      return (
        `SUPABASE_S3_SECRET_ACCESS_KEY 与 SUPABASE_S3_ACCESS_KEY_ID 读出来是同一个值` +
        `（${c.accessKeyIdLength} 位，而 secret 应为 64 位）—— 运行时拿到的 secret 就是 access key id 本身。` +
        `若你**刚刚才改过**这个变量，说明改动没有进到运行时：EdgeOne 的环境变量在保存后` +
        `**必须重新部署**才会被函数读到；另外确认改的是「生产」环境、且点过保存。`
      )
    }
    // 长度判据比「签名不匹配」有用得多：Supabase 的 key 长度是固定的
    // （accessKeyId 32 位、secretAccessKey 64 位）。长度对不上 ⇒ 值在复制环节被
    // 截断/多粘了字符，重新复制一次即可；长度正常却还签名失败 ⇒ 是真·旧密钥。
    // 两者处置不同（改粘贴 vs 重置），所以这里必须先分开。
    if (c.accessKeyIdLength !== 32 || c.secretAccessKeyLength !== 64) {
      return (
        `凭据长度不对（accessKeyId ${c.accessKeyIdLength} 位、secretAccessKey ${c.secretAccessKeyLength} 位；` +
        `Supabase 固定为 32 / 64 位）—— 值在复制粘贴时被截断或多带了字符。` +
        `请回 Supabase 控制台 Storage → S3 access keys 重新完整复制一次。`
      )
    }
    return (
      '凭据签名不匹配，且环境变量本身干净、长度也正确 —— 说明运行时的那份 secret 与 Supabase ' +
      '当前有效的那份不一致（多半是轮换过、或复制的是旧的）。请重新复制一次密钥、保存并重新部署。'
    )
  }
  if (/InvalidAccessKeyId/i.test(text)) {
    return 'accessKeyId 在 Supabase 里不存在 —— 确认它与 SUPABASE_PROJECT_REF 属于同一个项目。'
  }
  // 网络类要先于 404 判：`ENOTFOUND` 里就含 `NOTFOUND`，顺序反了会把
  // 「域名解析失败」误报成「端点少了 /s3」，把人引到完全错误的方向上。
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text)) {
    return '函数出口到不了对象存储域名 —— 检查 EdgeOne 的出网策略，或改用直连域。'
  }
  if (/NotFound|404/i.test(text)) {
    return '端点路径不对，应为 https://<ref>.supabase.co/storage/v1/s3（少 /s3 会 404）。'
  }
  return '见下方 putObject / headBucket 的 error 字段。'
}
