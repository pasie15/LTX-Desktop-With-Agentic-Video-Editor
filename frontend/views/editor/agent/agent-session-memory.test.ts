import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import {
  countUserTurns,
  lastUserText,
  parseHydratedMemory,
  restorePendingAskUser,
  serializeHydratedMemory,
} from './agent-session-memory.ts'

describe('agent session memory', () => {
  it('parses a saved plan and restores a pending review card', () => {
    const memory = parseHydratedMemory({
      plan: { goal: 'Midnight by the river', shots: [{ prompt: 'bridge' }], voStrategy: '', refs: [], titles: '', mix: '', timing: '', checks: [] },
      assemblyConfirmedMore: true,
      pendingAskUser: [{ id: 'review', prompt: 'Approve the still', kind: 'approval' }],
    })
    assert.equal(memory.plan?.goal, 'Midnight by the river')
    assert.equal(memory.assemblyConfirmedMore, true)
    assert.equal(memory.pendingAskUser?.[0]?.id, 'review')
    assert.ok(serializeHydratedMemory(memory)?.plan)

    const restored = restorePendingAskUser({
      messages: [
        { id: 'u1', role: 'user', createdAt: 1, parts: [{ type: 'text', text: 'Keep going on the river video' }] },
        {
          id: 't1',
          role: 'tool',
          createdAt: 2,
          parts: [{
            type: 'tool_result',
            id: 'call-1',
            name: 'assemble_shots',
            result: { ok: true, needsReview: true, checkpoint: 'still', nextStep: 'video' },
          }],
        },
      ],
      memory: {},
    })
    assert.equal(restored?.[0]?.id, 'review')
    assert.equal(restorePendingAskUser({
      messages: [{ id: 'u2', role: 'user', createdAt: 3, parts: [{ type: 'text', text: 'Answers:\n- review: Approve' }] }],
      memory: { pendingAskUser: restored },
    }), null)
  })

  it('counts follow-up turns so the agent can continue the same chat', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, createdAt: 1, parts: [{ type: 'text' as const, text: 'Make the Ken video' }] },
      { id: 'a1', role: 'assistant' as const, createdAt: 2, parts: [{ type: 'text' as const, text: 'Planning.' }] },
      { id: 'u2', role: 'user' as const, createdAt: 3, parts: [{ type: 'text' as const, text: 'Continue, but wet coat on the bridge' }] },
    ]
    assert.equal(countUserTurns(messages), 2)
    assert.equal(lastUserText(messages), 'Continue, but wet coat on the bridge')
    assert.match(AGENT_INSTRUCTIONS, /Same chat/)
    assert.doesNotMatch(AGENT_INSTRUCTIONS, /Every user send/)
  })
})
