import type { GlobalConfig } from 'payload'

/**
 * AI 模型配置（单例）：集中管理供应商 / API Key / 可用模型，供后台测试与前台功能共用。
 *
 * 设计要点：
 * - 只做「OpenAI 兼容」协议：baseURL 指向兼容 /chat/completions 的服务即可
 *   （硅基流动 SiliconFlow、DeepSeek、智谱、通义、OpenAI 官方等都适用），加新供应商无需改代码。
 * - API Key 只存服务端数据库，**绝不下发到浏览器**：Global 的 read 仅登录用户可读，
 *   后台管理页走专用 API（/api/admin/ai-models）并对 key 脱敏；前台功能走 /api/ai/chat 服务端代理。
 * - allowFrontend：只有标记为「前台可用」的模型才会被 /api/ai/chat 接受，避免后台测试模型被公开调用。
 */
export const AiModels: GlobalConfig = {
  slug: 'ai-models',
  label: 'AI 模型',
  access: {
    // API Key 敏感：读写都仅限登录管理员，禁止公开读取
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    description: '配置 OpenAI 兼容的模型供应商与 API Key，供后台测试与前台 AI 功能调用。API Key 不会下发到浏览器。',
  },
  fields: [
    {
      name: 'providers',
      type: 'array',
      label: '模型供应商',
      labels: { singular: '供应商', plural: '供应商' },
      fields: [
        { name: 'name', type: 'text', required: true, label: '名称', admin: { description: '如「硅基流动」「DeepSeek 官方」' } },
        {
          name: 'baseURL',
          type: 'text',
          required: true,
          label: 'Base URL',
          admin: { description: 'OpenAI 兼容根地址，如 https://api.siliconflow.cn/v1（末尾不带 /chat/completions）' },
        },
        {
          name: 'apiKey',
          type: 'text',
          required: true,
          label: 'API Key',
          admin: { description: '仅保存在服务端，前端只会看到脱敏后的掩码' },
        },
        { name: 'enabled', type: 'checkbox', label: '启用', defaultValue: true },
        {
          name: 'models',
          type: 'array',
          label: '可用模型',
          labels: { singular: '模型', plural: '模型' },
          fields: [
            { name: 'modelId', type: 'text', required: true, label: '模型 ID', admin: { description: '接口里传的 model 值，如 Qwen/Qwen2.5-7B-Instruct' } },
            { name: 'displayName', type: 'text', label: '显示名称', admin: { description: '留空则显示模型 ID' } },
            { name: 'free', type: 'checkbox', label: '免费模型', defaultValue: true },
            { name: 'contextLength', type: 'number', label: '上下文长度', admin: { description: '可选，仅用于展示' } },
            {
              name: 'allowFrontend',
              type: 'checkbox',
              label: '允许前台调用',
              defaultValue: false,
              admin: { description: '开启后前台功能（如 AI 摘要）可调用此模型，会产生额度消耗，请谨慎' },
            },
          ],
        },
      ],
    },
  ],
}

export default AiModels
