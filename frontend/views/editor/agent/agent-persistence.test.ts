import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSafeChatSessionId,
  parseChatSession,
  serializeChatSession,
  type AgentChatStorage,
} from './agent-persistence.ts'
import { createAgentSessionId, type AgentChatSession } from './agent-types.ts'

describe('agent chat persistence', () => {
  it('rejects unsafe session ids and parses session files', () => {
    assert.equal(isSafeChatSessionId('chat-abc_1'), true)
    assert.equal(isSafeChatSessionId('../secret'), false)
    const session: AgentChatSession = {
      id: 'chat-1',
      title: "What's on the timeline?",
      updatedAt: 10,
      messages: [],
      approveAll: true,
      memory: { plan: { goal: 'Keep going', shots: [], voStrategy: '', refs: [], titles: '', mix: '', timing: '', checks: [] } },
    }
    const parsed = parseChatSession(JSON.parse(serializeChatSession(session)))
    assert.deepEqual(parsed, session)
    assert.equal(parseChatSession({
      id: 'chat-2',
      title: 'legacy',
      updatedAt: 1,
      messages: [],
    })?.approveAll, undefined)
    assert.equal(parseChatSession({ id: '../x', title: 'no', updatedAt: 1, messages: [] }), null)
  })

  it('round-trips sessions through injected storage', async () => {
    const store = new Map<string, AgentChatSession>()
    const storage: AgentChatStorage = {
      async list() {
        return [...store.values()].map(session => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
        }))
      },
      async read(_projectId, sessionId) {
        return store.get(sessionId) ?? null
      },
      async write(_projectId, session) {
        store.set(session.id, session)
      },
      async remove(_projectId, sessionId) {
        store.delete(sessionId)
      },
    }
    const session: AgentChatSession = {
      id: createAgentSessionId(),
      title: 'New chat',
      updatedAt: 1,
      messages: [],
    }
    await storage.write('proj', session)
    assert.equal((await storage.list('proj')).length, 1)
    assert.equal((await storage.read('proj', session.id))?.id, session.id)
    await storage.remove('proj', session.id)
    assert.equal((await storage.list('proj')).length, 0)
  })
})
