/**
 * 内置 AI 平台预设（前后台共用）。
 * 每个平台预置官方 OpenAI 兼容 Base URL 与常见模型，用户只需选平台 + 填 API Key。
 * 模型是否免费/额度以各平台当前政策为准，这里仅作参考标注。
 */

export interface AiPresetModel {
  id: string
  name: string
  free?: boolean
  note?: string
}

export interface AiPlatformPreset {
  id: string
  name: string
  /** 简称，用于卡片图标角标 */
  short: string
  /** 品牌色，用于图标底色 */
  color: string
  baseURL: string
  keyUrl: string
  docs: string
  models: AiPresetModel[]
  defaultModel: string
}

export const AI_PLATFORM_PRESETS: AiPlatformPreset[] = [
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    short: 'SF',
    color: '#6c5ce7',
    baseURL: 'https://api.siliconflow.cn/v1',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    docs: 'https://docs.siliconflow.cn/',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    models: [
      { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5 7B', free: true },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B' },
      { id: 'THUDM/GLM-4-9B-0414', name: 'GLM-4 9B', free: true },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    short: 'GLM',
    color: '#3d82e8',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docs: 'https://docs.bigmodel.cn/',
    defaultModel: 'glm-4-flash',
    models: [
      { id: 'glm-4-flash', name: 'GLM-4-Flash', free: true, note: '免费' },
      { id: 'glm-4-flashx', name: 'GLM-4-FlashX', free: true },
      { id: 'glm-4-plus', name: 'GLM-4-Plus' },
      { id: 'glm-4-air', name: 'GLM-4-Air' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    short: 'DS',
    color: '#4d6bfe',
    baseURL: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com/',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 Chat', note: '低价，非免费' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1', note: '低价，非免费' },
    ],
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    short: 'K',
    color: '#111827',
    baseURL: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', name: 'Kimi 8K' },
      { id: 'moonshot-v1-32k', name: 'Kimi 32K' },
      { id: 'moonshot-v1-128k', name: 'Kimi 128K' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    short: 'OA',
    color: '#10a37f',
    baseURL: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    docs: 'https://platform.openai.com/docs',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', note: '低价，非免费' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    ],
  },
]

/** 按预设 id 查找 */
export function getPlatformPreset(id: string): AiPlatformPreset | undefined {
  return AI_PLATFORM_PRESETS.find((p) => p.id === id)
}
