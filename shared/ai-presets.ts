/**
 * 内置 AI 平台预设（前后台共用）。
 * 每个平台预置官方 OpenAI 兼容 Base URL 与常见模型，用户只需选平台 + 填 API Key。
 * 模型是否免费/额度以各平台当前政策为准，这里仅作参考标注。
 *
 * 免费与价格标注说明：
 * - free: true 表示官方定价页明确「输入/输出单价」为免费（非"限时免费"的缓存存储）
 * - pricing 记录官方输入/输出单价（元/百万 Tokens），便于界面标注收费模型
 * - 数据来源：各平台官方定价页，最后核对时间见各平台注释
 */

export interface AiPresetModel {
  id: string
  name: string
  /** 官方定价页明确输入输出免费 */
  free?: boolean
  /** 输入单价（元/百万 Tokens），0 表示免费 */
  inputPrice?: number
  /** 输出单价（元/百万 Tokens），0 表示免费 */
  outputPrice?: number
  /** 上下文长度，如 '128K'、'1M' */
  context?: string
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
  /** 拉取模型列表的路径，默认 /models（OpenAI 兼容） */
  modelsPath?: string
  /**
   * 是否完全信任 /models 返回（不补充本地预设里平台没返回的模型）。
   * 模型库庞大的平台（如硅基流动有数百个模型）应设为 true，
   * 否则本地预设会带入已下线的模型。
   */
  trustRemoteModels?: boolean
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
    // 硅基流动模型库有数百个且频繁上下架，完全以 /models 返回为准，
    // 预设只作为免费/价格元数据字典，不作为模型清单来源。
    trustRemoteModels: true,
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    models: [
      { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5 7B', free: true, inputPrice: 0, outputPrice: 0 },
      { id: 'THUDM/GLM-4-9B-0414', name: 'GLM-4 9B', free: true, inputPrice: 0, outputPrice: 0 },
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
    defaultModel: 'glm-4.7-flash',
    // 价格核对来源：https://docs.bigmodel.cn/cn/guide/start/pricing.md（2026-11）
    models: [
      // ===== 免费模型（官方定价页明确输入/输出均为「免费」）=====
      {
        id: 'glm-4.7-flash',
        name: 'GLM-4.7-Flash',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        context: '200K',
        note: '免费 · 上下文 200K',
      },
      {
        id: 'glm-4-flash-250414',
        name: 'GLM-4-Flash-250414',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        context: '128K',
        note: '免费 · 上下文 128K',
      },
      {
        id: 'glm-z1-flash',
        name: 'GLM-Z1-Flash',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        context: '128K',
        note: '免费 · 推理模型',
      },
      {
        id: 'glm-4.6v-flash',
        name: 'GLM-4.6V-Flash',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        note: '免费 · 视觉理解',
      },
      {
        id: 'glm-4v-flash',
        name: 'GLM-4V-Flash',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        context: '4K',
        note: '免费 · 视觉理解',
      },
      {
        id: 'glm-4.1v-thinking-flash',
        name: 'GLM-4.1V-Thinking-Flash',
        free: true,
        inputPrice: 0,
        outputPrice: 0,
        context: '64K',
        note: '免费 · 视觉推理',
      },
      // ===== 收费模型（主力型号）=====
      { id: 'glm-5.3', name: 'GLM-5.3', inputPrice: 8, outputPrice: 28, context: '1M' },
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', inputPrice: 0.8, outputPrice: 2.8, context: '1M' },
      { id: 'glm-5.3-flashx', name: 'GLM-5.3-FlashX', inputPrice: 2, outputPrice: 7, context: '1M' },
      { id: 'glm-5.2', name: 'GLM-5.2', inputPrice: 8, outputPrice: 28, context: '1M' },
      { id: 'glm-5.1', name: 'GLM-5.1', inputPrice: 6, outputPrice: 24, context: '200K' },
      { id: 'glm-5-turbo', name: 'GLM-5-Turbo', inputPrice: 5, outputPrice: 22, context: '200K' },
      { id: 'glm-5', name: 'GLM-5', inputPrice: 4, outputPrice: 18, context: '200K' },
      { id: 'glm-4.7', name: 'GLM-4.7', inputPrice: 2, outputPrice: 8, context: '200K' },
      { id: 'glm-4.7-flashx', name: 'GLM-4.7-FlashX', inputPrice: 0.5, outputPrice: 3, context: '200K' },
      { id: 'glm-4.6', name: 'GLM-4.6', inputPrice: 2, outputPrice: 8, context: '200K' },
      { id: 'glm-4.5-air', name: 'GLM-4.5-Air', inputPrice: 0.8, outputPrice: 2, context: '128K' },
      { id: 'glm-4-plus', name: 'GLM-4-Plus', inputPrice: 5, outputPrice: 5, context: '128K' },
      { id: 'glm-4-air-250414', name: 'GLM-4-Air-250414', inputPrice: 0.5, outputPrice: 0.5, context: '128K' },
      { id: 'glm-4-long', name: 'GLM-4-Long', inputPrice: 1, outputPrice: 1, context: '1M' },
      { id: 'glm-z1-air', name: 'GLM-Z1-Air', inputPrice: 0.5, outputPrice: 0.5, context: '128K' },
      { id: 'glm-z1-airx', name: 'GLM-Z1-AirX', inputPrice: 5, outputPrice: 5, context: '32K' },
      { id: 'glm-z1-flashx', name: 'GLM-Z1-FlashX', inputPrice: 0.1, outputPrice: 0.1, context: '128K' },
      { id: 'glm-4-flashx-250414', name: 'GLM-4-FlashX-250414', inputPrice: 0.1, outputPrice: 0.1, context: '128K' },
      { id: 'glm-4.6v', name: 'GLM-4.6V', inputPrice: 1, outputPrice: 3, context: '128K' },
      { id: 'glm-4.6v-flashx', name: 'GLM-4.6V-FlashX', inputPrice: 0.15, outputPrice: 1.5, context: '128K' },
      { id: 'glm-4.5v', name: 'GLM-4.5V', inputPrice: 2, outputPrice: 6, context: '64K' },
      { id: 'glm-4v-plus-0111', name: 'GLM-4V-Plus-0111', inputPrice: 4, outputPrice: 4, context: '16K' },
      {
        id: 'glm-4.1v-thinking-flashx',
        name: 'GLM-4.1V-Thinking-FlashX',
        inputPrice: 2,
        outputPrice: 2,
        context: '64K',
      },
      { id: 'glm-ocr', name: 'GLM-OCR', inputPrice: 0.2, outputPrice: 0.2, context: '32K' },
      { id: 'embedding-3', name: 'Embedding-3', inputPrice: 0.5, outputPrice: 0.5, context: '8K', note: '向量模型' },
      { id: 'embedding-2', name: 'Embedding-2', inputPrice: 0.5, outputPrice: 0.5, context: '8K', note: '向量模型' },
      { id: 'codegeex-4', name: 'CodeGeeX-4', inputPrice: 0.1, outputPrice: 0.1, context: '128K', note: '代码生成' },
      { id: 'rerank', name: 'Rerank', inputPrice: 0.8, outputPrice: 0.8, context: '4K', note: '重排序' },
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
    defaultModel: 'deepseek-flash',
    // 核对来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing（2026-11）
    // 当前仅 2 个正式模型；deepseek-chat / deepseek-reasoner 已不存在
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash',
        context: '1M',
        inputPrice: 1,
        outputPrice: 4,
        note: '空闲时段 ¥1/¥4，高峰 ¥2/¥8',
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        context: '1M',
        inputPrice: 4.5,
        outputPrice: 13.5,
        note: '空闲时段 ¥4.5/¥13.5，高峰 ¥9/¥27',
      },
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
    defaultModel: 'kimi-k3.1-pro',
    // 核对来源：https://platform.kimi.com/docs/models.md + /docs/api/models-overview.md（2026-11）
    // moonshot-v1-8k/32k/128k 已下线；K2 系列对新用户停开，老用户可用至 2026-12 底
    models: [
      // K3 系列（当前主力，1M 上下文）
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', context: '1M', note: '旗舰模型，按量计费' },
      { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro 高速版', context: '1M', note: '速度约 2-3 倍，按量计费' },
      { id: 'kimi-k3', name: 'Kimi K3', context: '1M', note: '上一代旗舰，按量计费' },
      // K2 系列（存量用户可用，2026-12 底下线）
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', context: '256K', note: '代码模型 · 老用户可用至 2026-12' },
      { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code 高速版', context: '256K', note: '老用户可用至 2026-12' },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', context: '256K', note: '老用户可用至 2026-12' },
    ],
  },
]

/** 按预设 id 查找 */
export function getPlatformPreset(id: string): AiPlatformPreset | undefined {
  return AI_PLATFORM_PRESETS.find((p) => p.id === id)
}

/** 按平台 + 模型 id 查找预设模型信息（用于判断免费/价格） */
export function getPresetModel(platformId: string, modelId: string): AiPresetModel | undefined {
  const preset = getPlatformPreset(platformId)
  if (!preset) return undefined
  return preset.models.find((m) => m.id === modelId)
}

/** 判断某模型在预设里是否标记为免费 */
export function isPresetModelFree(platformId: string, modelId: string): boolean {
  return Boolean(getPresetModel(platformId, modelId)?.free)
}
