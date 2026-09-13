import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_LLM_CATALOG,
  AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL,
  catalogEntry,
  catalogModels,
  isAgentLlmKeyError,
  mergeAgentLlmModelOptions,
  providerDisplayLabel,
} from './agent-llm.ts'

describe('agent LLM catalog', () => {
  it('includes the requested Agent providers', () => {
    const kinds = AGENT_LLM_CATALOG.map(entry => entry.kind)
    for (const kind of ['gemini', 'openai', 'anthropic', 'openrouter', 'zai', 'minimax', 'moonshot', 'xai', 'custom_openai', 'custom_anthropic']) {
      assert.ok(kinds.includes(kind as typeof kinds[number]), kind)
    }
  })

  it('marks Connect-capable providers', () => {
    assert.equal(catalogEntry('openai').supportsConnect, true)
    assert.equal(catalogEntry('anthropic').supportsConnect, true)
    assert.equal(catalogEntry('minimax').supportsConnect, true)
    assert.equal(catalogEntry('xai').supportsConnect, true)
    assert.equal(catalogEntry('moonshot').supportsConnect, true)
    assert.equal(catalogEntry('groq').supportsConnect, false)
  })

  it('marks custom endpoints as requiring a base URL', () => {
    assert.equal(catalogEntry('custom_openai').requiresBaseUrl, true)
    assert.equal(catalogEntry('openai').requiresBaseUrl, false)
  })
})

describe('catalogModels', () => {
  it('lists latest models first and keeps the rest', () => {
    const openai = catalogModels('openai').map(model => model.id)
    assert.equal(openai[0], 'gpt-5.4')
    assert.ok(openai.includes('gpt-4o'))
    assert.equal(catalogModels('anthropic')[0]?.id, 'claude-opus-4-6')
  })
})

describe('mergeAgentLlmModelOptions', () => {
  it('keeps fetched ids first and appends a custom current model', () => {
    const ids = mergeAgentLlmModelOptions(
      [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }],
      'openai',
      'my-fine-tune',
    ).map(model => model.id)
    assert.equal(ids[0], 'gpt-5.4')
    assert.equal(ids.filter(id => id === 'gpt-5.4').length, 1)
    assert.equal(ids.at(-1), 'my-fine-tune')
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
