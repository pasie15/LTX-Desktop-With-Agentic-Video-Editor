import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_LLM_ENHANCE_SETTINGS_DETAIL,
  isEnhanceBlockedByMissingAgentLlmKey,
} from './enhance-gemini-key.ts'

const blocked = {
  enhanceAvailableForMode: true,
  enhanceProvider: 'api' as const,
  hasAgentLlmKey: false,
  hasEnhanceInput: true,
  isGenerationInProgressForEnhance: false,
  isOtherGenerationRunning: false,
}

describe('isEnhanceBlockedByMissingAgentLlmKey', () => {
  it('is true when Enhance (API) is selected and no Agent LLM credential is configured', () => {
    assert.equal(isEnhanceBlockedByMissingAgentLlmKey(blocked), true)
  })

  it('is false when enhance is not available for the current mode', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, enhanceAvailableForMode: false }),
      false,
    )
  })

  it('is false when an Agent LLM credential is already configured', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, hasAgentLlmKey: true }),
      false,
    )
  })

  it('is false when Enhance is using the local provider, even without an Agent LLM key', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, enhanceProvider: 'local' }),
      false,
    )
  })

  it('is false when there is no prompt or image to enhance', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, hasEnhanceInput: false }),
      false,
    )
  })

  it('is false while this project is already generating', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, isGenerationInProgressForEnhance: true }),
      false,
    )
  })

  it('is false while another project is generating', () => {
    assert.equal(
      isEnhanceBlockedByMissingAgentLlmKey({ ...blocked, isOtherGenerationRunning: true }),
      false,
    )
  })
})

describe('AGENT_LLM_ENHANCE_SETTINGS_DETAIL', () => {
  it('opens Settings on the API Keys tab for the Agent LLM banner', () => {
    assert.deepEqual(AGENT_LLM_ENHANCE_SETTINGS_DETAIL, {
      tab: 'apiKeys',
      reason: 'agentLlmKeyRequired',
    })
  })
})
