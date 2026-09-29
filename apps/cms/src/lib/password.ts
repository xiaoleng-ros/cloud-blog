/**
 * 密码强度规则（服务端 Users 钩子与后台账号页共用，保证前后端口径一致）：
 * 长度 6-18，且大写字母、小写字母、数字、特殊字符四类中至少命中两类。
 */
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_MAX_LENGTH = 18
export const PASSWORD_RULE_TEXT = '长度 6-18 位，且大写、小写、数字、特殊字符至少包含两种组合'

/** @returns 合法返回 null；非法返回给用户看的错误文案 */
export const validatePasswordStrength = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return '密码长度需为 6-18 位'
  }
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (kinds < 2) {
    return '密码需包含大写、小写、数字、特殊字符中的至少两种'
  }
  return null
}
