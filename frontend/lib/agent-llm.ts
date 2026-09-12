export const BUILTIN_GEMINI_PROVIDER_ID = 'gemini'

export type AgentLlmProviderKind =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'zai'
  | 'minimax'
  | 'moonshot'
  | 'groq'
  | 'deepseek'
  | 'custom_openai'
  | 'custom_anthropic'

export interface AgentLlmProviderPublic {
  id: string
  kind: AgentLlmProviderKind
  label: string
  hasApiKey: boolean
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
}

export const AGENT_LLM_CATALOG: readonly AgentLlmCatalogEntry[] = [
  {
    kind: 'gemini',
    label: 'Gemini',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    requiresBaseUrl: false,
  },
  {
    kind: 'openai',
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4o',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'zai',
    label: 'Z.ai',
    defaultModel: 'glm-4.5',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikeys',
    requiresBaseUrl: false,
  },
  {
    kind: 'minimax',
    label: 'MiniMax',
    defaultModel: 'MiniMax-M2',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    requiresBaseUrl: false,
  },
  {
    kind: 'moonshot',
    label: 'Moonshot / Kimi',
    defaultModel: 'kimi-k2-0905-preview',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'groq',
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    requiresBaseUrl: false,
  },
  {
    kind: 'custom_openai',
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: '',
    requiresBaseUrl: true,
  },
  {
    kind: 'custom_anthropic',
    label: 'Custom (Anthropic-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    keyUrl: '',
    requiresBaseUrl: true,
  },
]

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

export function isAgentLlmKeyError(code?: string): boolean {
  return Boolean(code && AGENT_KEY_ERROR_CODES.has(code))
}

export function createAgentLlmProviderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `prov_${crypto.randomUUID()}`
  }
  return `prov_${Math.random().toString(36).slice(2, 12)}`
}
