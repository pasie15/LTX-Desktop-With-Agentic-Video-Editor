export const BUILTIN_GEMINI_PROVIDER_ID = 'gemini'

export type AgentLlmProviderKind =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'zai'
  | 'minimax'
  | 'moonshot'
  | 'xai'
  | 'groq'
  | 'deepseek'
  | 'custom_openai'
  | 'custom_anthropic'

export type AgentLlmAuthMode = 'api_key' | 'oauth'

export interface AgentLlmProviderPublic {
  id: string
  kind: AgentLlmProviderKind
  label: string
  hasApiKey: boolean
  hasOAuth: boolean
  authMode: AgentLlmAuthMode
  model: string
  baseUrl: string
}

export interface AgentLlmCatalogEntry {
  kind: AgentLlmProviderKind
  label: string
  defaultModel: string
  defaultBaseUrl: string
  keyUrl: string
  requiresBaseUrl: boolean
  supportsConnect: boolean
}

export const AGENT_LLM_CATALOG: readonly AgentLlmCatalogEntry[] = [
  {
    kind: 'gemini',
    label: 'Gemini',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    requiresBaseUrl: false,
    supportsConnect: false,
  },
  {
    kind: 'openai',
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-5.6-sol',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-5.6-sol',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    requiresBaseUrl: false,
    supportsConnect: false,
  },
  {
    kind: 'zai',
    label: 'Z.ai',
    defaultModel: 'glm-4.5',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikeys',
    requiresBaseUrl: false,
    supportsConnect: false,
  },
  {
    kind: 'minimax',
    label: 'MiniMax',
    defaultModel: 'MiniMax-M3',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'moonshot',
    label: 'Moonshot / Kimi',
    defaultModel: 'kimi-k3',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'xai',
    label: 'xAI (Grok)',
    defaultModel: 'grok-4.6',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'groq',
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    requiresBaseUrl: false,
    supportsConnect: false,
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    defaultBaseUrl: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    requiresBaseUrl: false,
    supportsConnect: false,
  },
  {
    kind: 'custom_openai',
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: '',
    requiresBaseUrl: true,
    supportsConnect: false,
  },
  {
    kind: 'custom_anthropic',
    label: 'Custom (Anthropic-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: '',
    requiresBaseUrl: true,
    supportsConnect: false,
  },
]

export interface AgentLlmModelOption {
  id: string
  displayName: string
  description?: string
}

export const AGENT_LLM_CATALOG_MODELS: Record<AgentLlmProviderKind, readonly AgentLlmModelOption[]> = {
  gemini: [
    { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash' },
    { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
    { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro' },
    { id: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
  ],
  openai: [
    { id: 'gpt-6-astra', displayName: 'GPT-6 Astra' },
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
    { id: 'gpt-5.5', displayName: 'GPT-5.5' },
    { id: 'gpt-5.4', displayName: 'GPT-5.4' },
    { id: 'gpt-5.3', displayName: 'GPT-5.3' },
    { id: 'gpt-5.2', displayName: 'GPT-5.2' },
    { id: 'gpt-5.1', displayName: 'GPT-5.1' },
    { id: 'gpt-5', displayName: 'GPT-5' },
    { id: 'gpt-5-mini', displayName: 'GPT-5 mini' },
    { id: 'gpt-5-nano', displayName: 'GPT-5 nano' },
    { id: 'gpt-4.1', displayName: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
    { id: 'o3', displayName: 'o3' },
    { id: 'o4-mini', displayName: 'o4-mini' },
    { id: 'o1', displayName: 'o1' },
  ],
  anthropic: [
    { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
    { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5 (20251001)' },
    { id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1' },
    { id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4' },
  ],
  openrouter: [
    { id: 'openai/gpt-6-astra', displayName: 'OpenAI: GPT-6 Astra' },
    { id: 'openai/gpt-5.6-sol', displayName: 'OpenAI: GPT-5.6 Sol' },
    { id: 'openai/gpt-5.6-terra', displayName: 'OpenAI: GPT-5.6 Terra' },
    { id: 'anthropic/claude-fable-5.1', displayName: 'Anthropic: Claude Fable 5.1' },
    { id: 'anthropic/claude-opus-5', displayName: 'Anthropic: Claude Opus 5' },
    { id: 'anthropic/claude-sonnet-5', displayName: 'Anthropic: Claude Sonnet 5' },
    { id: 'google/gemini-3.8-flash', displayName: 'Google: Gemini 3.8 Flash' },
    { id: 'x-ai/grok-4.6', displayName: 'xAI: Grok 4.6' },
    { id: 'moonshotai/kimi-k3', displayName: 'Moonshot: Kimi K3' },
    { id: 'minimax/minimax-m3', displayName: 'MiniMax: M3' },
    { id: 'deepseek/deepseek-v4-pro', displayName: 'DeepSeek: V4 Pro' },
    { id: 'deepseek/deepseek-chat', displayName: 'DeepSeek: Chat' },
    { id: 'openai/gpt-4o', displayName: 'OpenAI: GPT-4o' },
    { id: 'anthropic/claude-sonnet-4.5', displayName: 'Anthropic: Claude Sonnet 4.5' },
    { id: 'google/gemini-2.5-pro', displayName: 'Google: Gemini 2.5 Pro' },
  ],
  zai: [
    { id: 'glm-5', displayName: 'GLM-5' },
    { id: 'glm-4.7', displayName: 'GLM-4.7' },
    { id: 'glm-4.6', displayName: 'GLM-4.6' },
    { id: 'glm-4.5', displayName: 'GLM-4.5' },
    { id: 'glm-4.5-air', displayName: 'GLM-4.5 Air' },
    { id: 'glm-4-flash', displayName: 'GLM-4 Flash' },
  ],
  minimax: [
    { id: 'MiniMax-M3', displayName: 'MiniMax M3' },
    { id: 'MiniMax-M2.7', displayName: 'MiniMax M2.7' },
    { id: 'MiniMax-M2.7-highspeed', displayName: 'MiniMax M2.7 Highspeed' },
    { id: 'MiniMax-M2.5', displayName: 'MiniMax M2.5' },
    { id: 'MiniMax-M2.5-highspeed', displayName: 'MiniMax M2.5 Highspeed' },
    { id: 'MiniMax-M2.1', displayName: 'MiniMax M2.1' },
    { id: 'MiniMax-M2.1-highspeed', displayName: 'MiniMax M2.1 Highspeed' },
    { id: 'MiniMax-M2', displayName: 'MiniMax M2' },
  ],
  moonshot: [
    { id: 'kimi-k3', displayName: 'Kimi K3' },
    { id: 'kimi-k2.5', displayName: 'Kimi K2.5' },
    { id: 'kimi-k2-0905-preview', displayName: 'Kimi K2 0905' },
    { id: 'kimi-k2-turbo-preview', displayName: 'Kimi K2 Turbo' },
    { id: 'moonshot-v1-128k', displayName: 'Moonshot v1 128k' },
    { id: 'moonshot-v1-32k', displayName: 'Moonshot v1 32k' },
    { id: 'moonshot-v1-8k', displayName: 'Moonshot v1 8k' },
  ],
  xai: [
    { id: 'grok-4.6', displayName: 'Grok 4.6' },
    { id: 'grok-4.5', displayName: 'Grok 4.5' },
    { id: 'grok-4', displayName: 'Grok 4' },
    { id: 'grok-3', displayName: 'Grok 3' },
    { id: 'grok-3-mini', displayName: 'Grok 3 Mini' },
    { id: 'grok-3-fast', displayName: 'Grok 3 Fast' },
    { id: 'grok-2', displayName: 'Grok 2' },
    { id: 'grok-2-vision-1212', displayName: 'Grok 2 Vision' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B' },
    { id: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B' },
    { id: 'qwen/qwen3.8-27b', displayName: 'Qwen 3.8 27B' },
    { id: 'qwen/qwen3.6-27b', displayName: 'Qwen 3.6 27B' },
    { id: 'qwen/qwen3-32b', displayName: 'Qwen 3 32B' },
    { id: 'moonshotai/kimi-k2-instruct-0905', displayName: 'Kimi K2 Instruct' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', displayName: 'Llama 4 Maverick' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', displayName: 'Llama 4 Scout' },
    { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant' },
    { id: 'groq/compound', displayName: 'Groq Compound' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
    { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' },
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
  ],
  custom_openai: [
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
  ],
  custom_anthropic: [
    { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
    { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    { id: 'MiniMax-M3', displayName: 'MiniMax M3' },
  ],
}

export const CUSTOM_AGENT_LLM_MODEL_VALUE = '__custom__'

export function catalogModels(kind: AgentLlmProviderKind): AgentLlmModelOption[] {
  return [...(AGENT_LLM_CATALOG_MODELS[kind] ?? [])]
}

export function mergeAgentLlmModelOptions(
  fetched: readonly AgentLlmModelOption[],
  kind: AgentLlmProviderKind,
  includeId = '',
): AgentLlmModelOption[] {
  const ordered: AgentLlmModelOption[] = []
  const seen = new Set<string>()
  for (const model of [...fetched, ...catalogModels(kind)]) {
    const id = model.id.trim()
    if (!id || seen.has(id)) continue
    ordered.push(model)
    seen.add(id)
  }
  const included = includeId.trim()
  if (included && !seen.has(included)) {
    ordered.push({ id: included, displayName: included })
  }
  return ordered
}

export const AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL = {
  tab: 'apiKeys' as const,
  reason: 'agentLlmKeyRequired' as const,
}

const AGENT_KEY_ERROR_CODES = new Set([
  'GEMINI_API_KEY_MISSING',
  'GEMINI_INVALID_API_KEY',
  'AGENT_LLM_KEY_MISSING',
  'AGENT_LLM_INVALID_API_KEY',
  'AGENT_LLM_PROVIDER_INVALID',
])

export function catalogEntry(kind: AgentLlmProviderKind): AgentLlmCatalogEntry {
  return AGENT_LLM_CATALOG.find(entry => entry.kind === kind) ?? AGENT_LLM_CATALOG[0]
}

export function providerDisplayLabel(provider: Pick<AgentLlmProviderPublic, 'kind' | 'label'>): string {
  return provider.label.trim() || catalogEntry(provider.kind).label
}

export function providerHasCredential(provider: AgentLlmProviderPublic): boolean {
  return provider.hasOAuth || provider.hasApiKey || provider.kind === 'gemini'
}

export function isAgentLlmKeyError(code?: string): boolean {
  return Boolean(code && AGENT_KEY_ERROR_CODES.has(code))
}

export function createAgentLlmProviderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `prov_${crypto.randomUUID()}`
  }
  return `prov_${Math.random().toString(36).slice(2, 12)}`
}
