import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_LLM_CATALOG,
  AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL,
  catalogEntry,
  isAgentLlmKeyError,
  providerDisplayLabel,
} from './agent-llm.ts'

describe('agent LLM catalog', () => {
  it('includes the requested Agent providers', () => {
    const kinds = AGENT_LLM_CATALOG.map(entry => entry.kind)
    for (const kind of ['gemini', 'openai', 'anthropic', 'openrouter', 'zai', 'minimax', 'moonshot', 'custom_openai', 'custom_anthropic']) {
      assert.ok(kinds.includes(kind as typeof kinds[number]), kind)
    }
  })

  it('marks custom endpoints as requiring a base URL', () => {
    assert.equal(catalogEntry('custom_openai').requiresBaseUrl, true)
    assert.equal(catalogEntry('openai').requiresBaseUrl, false)
  })
})

describe('providerDisplayLabel', () => {
  it('prefers a stored label, then the catalog name', () => {
    assert.equal(providerDisplayLabel({ kind: 'openai', label: 'Work' }), 'Work')
    assert.equal(providerDisplayLabel({ kind: 'moonshot', label: '' }), 'Moonshot / Kimi')
  })
})

describe('isAgentLlmKeyError', () => {
  it('treats Gemini and generic Agent key failures as settings errors', () => {
    assert.equal(isAgentLlmKeyError('GEMINI_API_KEY_MISSING'), true)
    assert.equal(isAgentLlmKeyError('AGENT_LLM_KEY_MISSING'), true)
    assert.equal(isAgentLlmKeyError('AGENT_LLM_INVALID_API_KEY'), true)
    assert.equal(isAgentLlmKeyError('SOME_OTHER'), false)
  })
})

describe('AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL', () => {
  it('opens Settings on the API Keys tab for the Agent LLM section', () => {
    assert.deepEqual(AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL, {
      tab: 'apiKeys',
      reason: 'agentLlmKeyRequired',
    })
  })
})
