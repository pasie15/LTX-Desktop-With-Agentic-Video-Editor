import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agentChatToggleCopy } from './agent-chat-toggle.ts'

describe('agent chat toggle copy', () => {
  it('always shows Agent as the visible label', () => {
    assert.equal(agentChatToggleCopy(false).visibleLabel, 'Agent')
    assert.equal(agentChatToggleCopy(true).visibleLabel, 'Agent')
  })

  it('uses Show/Hide Agent for the action label', () => {
    assert.equal(agentChatToggleCopy(false).actionLabel, 'Show Agent')
    assert.equal(agentChatToggleCopy(true).actionLabel, 'Hide Agent')
    assert.equal(agentChatToggleCopy(false).pressed, false)
    assert.equal(agentChatToggleCopy(true).pressed, true)
  })
})
