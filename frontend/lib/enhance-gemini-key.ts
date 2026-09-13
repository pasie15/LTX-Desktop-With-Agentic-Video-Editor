export const AGENT_LLM_ENHANCE_SETTINGS_DETAIL = {
  tab: 'apiKeys' as const,
  reason: 'agentLlmKeyRequired' as const,
}

/** @deprecated Use AGENT_LLM_ENHANCE_SETTINGS_DETAIL — Enhance (API) is no longer Gemini-only. */
export const GEMINI_KEY_REQUIRED_SETTINGS_DETAIL = AGENT_LLM_ENHANCE_SETTINGS_DETAIL

export function isEnhanceBlockedByMissingAgentLlmKey(input: {
  enhanceAvailableForMode: boolean
  enhanceProvider: 'local' | 'api'
  hasAgentLlmKey: boolean
  hasEnhanceInput: boolean
  isGenerationInProgressForEnhance: boolean
  isOtherGenerationRunning: boolean
}): boolean {
  // True when Enhance would run via the selected Agent LLM but no credential is configured —
  // including when local Enhance is available and the user explicitly picked API. Clicking then
  // opens Settings instead of hiding the API option.
  return (
    input.enhanceAvailableForMode
    && input.enhanceProvider === 'api'
    && !input.hasAgentLlmKey
    && input.hasEnhanceInput
    && !input.isGenerationInProgressForEnhance
    && !input.isOtherGenerationRunning
  )
}

/** @deprecated Use isEnhanceBlockedByMissingAgentLlmKey */
export function isEnhanceBlockedByMissingGeminiKey(input: {
  enhanceAvailableForMode: boolean
  enhanceProvider: 'local' | 'api'
  hasGeminiApiKey: boolean
  hasEnhanceInput: boolean
  isGenerationInProgressForEnhance: boolean
  isOtherGenerationRunning: boolean
}): boolean {
  return isEnhanceBlockedByMissingAgentLlmKey({
    enhanceAvailableForMode: input.enhanceAvailableForMode,
    enhanceProvider: input.enhanceProvider,
    hasAgentLlmKey: input.hasGeminiApiKey,
    hasEnhanceInput: input.hasEnhanceInput,
    isGenerationInProgressForEnhance: input.isGenerationInProgressForEnhance,
    isOtherGenerationRunning: input.isOtherGenerationRunning,
  })
}
