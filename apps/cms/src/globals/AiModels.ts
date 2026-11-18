import type { GlobalConfig } from 'payload'

/**
 * AI 模型配置（单例）：用户只需选内置平台 + 填 API Key + 选模型。
 *
 * - 平台预设（名称 / Base URL / 可用模型）来自 shared/ai-presets，不入库。
 * - 只存：platformId、apiKey、modelId、开关。API Key 仅服务端可见。
 */
export const AiModels: GlobalConfig = {
  slug: 'ai-models',
  label: 'AI 模型',
  access: {
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    description: '选择内置平台、填入 API Key 即可使用。API Key 只存服务端，不会下发到浏览器。',
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
        { name: 'modelId', type: 'text', required: true, label: '使用的模型 ID' },
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
