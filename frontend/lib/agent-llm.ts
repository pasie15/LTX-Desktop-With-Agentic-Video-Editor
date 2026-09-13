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
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4o',
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
    defaultModel: 'MiniMax-M2',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'moonshot',
    label: 'Moonshot / Kimi',
    defaultModel: 'kimi-k2-0905-preview',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresBaseUrl: false,
    supportsConnect: true,
  },
  {
    kind: 'xai',
    label: 'xAI (Grok)',
    defaultModel: 'grok-4',
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
    defaultModel: 'deepseek-chat',
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
    { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
    { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' },
    { id: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
  ],
  openai: [
    { id: 'gpt-5.4', displayName: 'GPT-5.4' },
    { id: 'gpt-5.3', displayName: 'GPT-5.3' },
    { id: 'gpt-5.2', displayName: 'GPT-5.2' },
    { id: 'gpt-5.1', displayName: 'GPT-5.1' },
    { id: 'gpt-5', displayName: 'GPT-5' },
    { id: 'gpt-4.1', displayName: 'GPT-4.1' },
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
    { id: 'o3', displayName: 'o3' },
    { id: 'o4-mini', displayName: 'o4-mini' },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1' },
    { id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4' },
  ],
  openrouter: [
    { id: 'openai/gpt-5', displayName: 'OpenAI: GPT-5' },
    { id: 'anthropic/claude-sonnet-4.5', displayName: 'Anthropic: Claude Sonnet 4.5' },
    { id: 'google/gemini-2.5-pro', displayName: 'Google: Gemini 2.5 Pro' },
    { id: 'openai/gpt-4o', displayName: 'OpenAI: GPT-4o' },
    { id: 'anthropic/claude-sonnet-4', displayName: 'Anthropic: Claude Sonnet 4' },
  ],
  zai: [
    { id: 'glm-4.6', displayName: 'GLM-4.6' },
    { id: 'glm-4.5', displayName: 'GLM-4.5' },
    { id: 'glm-4.5-air', displayName: 'GLM-4.5 Air' },
  ],
  minimax: [
    { id: 'MiniMax-M2.5', displayName: 'MiniMax M2.5' },
    { id: 'MiniMax-M2', displayName: 'MiniMax M2' },
    { id: 'MiniMax-M1', displayName: 'MiniMax M1' },
  ],
  moonshot: [
    { id: 'kimi-k2.5', displayName: 'Kimi K2.5' },
    { id: 'kimi-k2-0905-preview', displayName: 'Kimi K2 0905' },
    { id: 'kimi-k2-turbo-preview', displayName: 'Kimi K2 Turbo' },
    { id: 'moonshot-v1-128k', displayName: 'Moonshot v1 128k' },
  ],
  xai: [
    { id: 'grok-4', displayName: 'Grok 4' },
    { id: 'grok-3', displayName: 'Grok 3' },
    { id: 'grok-3-mini', displayName: 'Grok 3 Mini' },
    { id: 'grok-2', displayName: 'Grok 2' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B' },
    { id: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', displayName: 'Llama 4 Maverick' },
    { id: 'qwen/qwen3-32b', displayName: 'Qwen 3 32B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
  ],
  custom_openai: [],
  custom_anthropic: [],
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
