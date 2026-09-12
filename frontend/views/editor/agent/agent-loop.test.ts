import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { answersToUserMessage, resolveOrphanToolUses, runAgentLoop } from './agent-loop.ts'
import { createAgentMessageId, type AgentChatMessage, type AgentTurnResponse } from './agent-types.ts'
import { READ_TOOL_DEFINITIONS } from './tool-definitions.ts'

function userText(text: string): AgentChatMessage {
  return {
    id: createAgentMessageId(),
    role: 'user',
    createdAt: 1,
    parts: [{ type: 'text', text }],
  }
}

describe('agent loop', () => {
  it('executes a read tool then stops on final text', async () => {
    const responses: AgentTurnResponse[] = [
      {
        status: 'success',
        text: '',
        toolCalls: [{ id: 'call_1', name: 'get_timeline', arguments: {} }],
        askUser: null,
        finishReason: 'tool_calls',
      },
      {
        status: 'success',
        text: 'One clip on V1.',
        toolCalls: [],
        askUser: null,
        finishReason: 'stop',
      },
    ]
    let messages = [userText("What's on the timeline?")]
    const executed: string[] = []
    const result = await runAgentLoop({
      getMessages: () => messages,
      getProjectContext: () => ({ project: { name: 'Demo' } }),
      availableTools: READ_TOOL_DEFINITIONS,
      skills: 'Read-only.',
      requestTurn: async () => responses.shift()!,
      executeTool: async (name) => {
        executed.push(name)
        return { ok: true, clipCount: 1 }
      },
      onMessages: next => { messages = next },
      onAskUser: () => {},
      signal: new AbortController().signal,
    })
    assert.equal(result.stopReason, 'stop')
    assert.deepEqual(executed, ['get_timeline'])
    assert.equal(result.messages.at(-1)?.parts[0]?.type, 'text')
    assert.equal(result.messages.at(-1)?.parts[0]?.type === 'text' && result.messages.at(-1)?.parts[0].text, 'One clip on V1.')
  })

  it('pauses on ask_user and synthesizes orphan tool results on cancel', async () => {
    const controller = new AbortController()
    let messages = [userText('How long?')]
    const result = await runAgentLoop({
      getMessages: () => messages,
      getProjectContext: () => ({}),
      availableTools: READ_TOOL_DEFINITIONS,
      skills: '',
      requestTurn: async () => ({
        status: 'success',
        text: 'Need a duration.',
        toolCalls: [],
        askUser: [{ id: 'duration', prompt: 'How long?', kind: 'choice', options: ['4s'] }],
        finishReason: 'ask_user',
      }),
      executeTool: async () => ({ ok: true }),
      onMessages: next => { messages = next },
      onAskUser: questions => {
        assert.equal(questions[0]?.id, 'duration')
      },
      signal: controller.signal,
    })
    assert.equal(result.stopReason, 'ask_user')
    assert.ok(answersToUserMessage({ duration: '4s' }).parts[0]?.type === 'text')

    const withOrphan: AgentChatMessage[] = [
      userText('go'),
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        parts: [{ type: 'tool_call', id: 'call_9', name: 'get_timeline', arguments: {} }],
      },
    ]
    const resolved = resolveOrphanToolUses(withOrphan)
    const last = resolved.at(-1)
    assert.equal(last?.role, 'tool')
    assert.equal(last?.parts[0]?.type, 'tool_result')
    if (last?.parts[0]?.type === 'tool_result') {
      assert.equal(last.parts[0].result.error, 'cancelled')
    }
  })

  it('pauses the loop when a generate tool needs confirmation', async () => {
    let messages = [userText('Generate a 4s cutaway')]
    let asked: string[] = []
    const result = await runAgentLoop({
      getMessages: () => messages,
      getProjectContext: () => ({}),
      availableTools: READ_TOOL_DEFINITIONS,
      skills: '',
      requestTurn: async () => ({
        status: 'success',
        text: '',
        toolCalls: [{ id: 'call_g', name: 'generate_video', arguments: { prompt: 'rain', duration: 4 } }],
        askUser: null,
        finishReason: 'tool_calls',
      }),
      executeTool: async () => ({
        ok: false,
        needsConfirm: true,
        proposal: { tool: 'generate_video', prompt: 'rain', duration: 4, model: 'fast', resolution: '540p' },
        error: 'Generation needs confirmation.',
      }),
      onMessages: next => { messages = next },
      onAskUser: questions => {
        asked = questions.map(question => question.id)
      },
      signal: new AbortController().signal,
    })
    assert.equal(result.stopReason, 'ask_user')
    assert.deepEqual(asked, ['confirm'])
  })
})
