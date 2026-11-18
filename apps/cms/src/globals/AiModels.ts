import type { GlobalConfig } from 'payload'

/**
 * AI 模型配置（单例）：选平台 + 填 Key + 拉取并选择该账号可用模型。
 *
 * - 平台信息（Base URL / 模型拉取端点）来自 shared/ai-presets，不入库。
 * - 每个平台存：platformId、apiKey、modelIds（多选）、currentModelId（当前使用）、开关。
 * - API Key 仅服务端可见；模型列表由 Key 实时从平台拉取后选择。
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
      type: 'array',
      label: '已配置平台',
      labels: { singular: '平台', plural: '平台' },
      fields: [
        {
          name: 'platformId',
          type: 'select',
          required: true,
          label: '平台',
          options: [
            { label: '硅基流动 SiliconFlow', value: 'siliconflow' },
            { label: '智谱 GLM', value: 'zhipu' },
            { label: 'DeepSeek 官方', value: 'deepseek' },
            { label: '月之暗面 Kimi', value: 'moonshot' },
            { label: 'OpenAI 官方', value: 'openai' },
          ],
        },
        {
          name: 'apiKey',
          type: 'text',
          required: true,
          label: 'API Key',
          admin: { description: '仅保存在服务端，前端只会看到脱敏后的掩码' },
        },
        {
          name: 'modelIds',
          type: 'json',
          label: '已选模型 ID 列表',
          admin: { description: '由弹窗拉取并多选后写入，一般不用手动改' },
        },
        {
          name: 'currentModelId',
          type: 'text',
          label: '当前使用模型',
          admin: { description: '可在后台卡片上切换；前台未指定模型时用它' },
        },
        { name: 'enabled', type: 'checkbox', label: '启用', defaultValue: true },
        {
          name: 'allowFrontend',
          type: 'checkbox',
          label: '允许前台调用',
          defaultValue: false,
          admin: { description: '开启后前台功能（如 AI 摘要）可调用，会产生额度消耗，请谨慎' },
        },
      ],
    },
  ],
}

export default AiModels
