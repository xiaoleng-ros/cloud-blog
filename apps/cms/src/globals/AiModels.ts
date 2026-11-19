import type { GlobalConfig } from 'payload'

/**
 * AI 模型配置（单例）：选平台 + 填 Key + 拉取并选择该账号可用模型。
 *
 * - 平台信息（Base URL / 模型拉取端点）来自 shared/ai-presets，不入库。
 * - 每个平台存：platformId、apiKey、modelIds（多选）、currentModelId（当前使用）、开关。
 * - API Key 仅服务端可见；模型列表由 Key 实时从平台拉取后选择。
 *
 * providers 用 json 字段而不是 array：这套配置由自定义页面（/admin/ai-models）整块读写，
 * 不需要 Payload 的数组编辑 UI。json 直接落在 ai_models.providers 这个 jsonb 列上，
 * 与迁移建表结构一致；若改成 array，Payload 会另建子表，导致写入与读取不在同一处。
 */
export const AiModels: GlobalConfig = {
  slug: 'ai-models',
  label: 'AI 模型',
  access: {
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    description: '选择平台、填入 API Key 后拉取该账号可用模型并选用。API Key 只存服务端，不下发浏览器。',
  },
  fields: [
    {
      name: 'providers',
      type: 'json',
      label: '已配置平台',
      admin: { description: '由「AI 模型」页面维护，一般不用手动改' },
    },
  ],
}

export default AiModels
