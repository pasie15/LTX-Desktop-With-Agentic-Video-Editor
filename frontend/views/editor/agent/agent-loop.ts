import { confirmQuestionsFromToolResult } from './agent-generate-runtime.ts'
import {
  createAgentMessageId,
  MAX_AGENT_MODEL_TURNS,
  type AgentAskUserQuestion,
  type AgentChatMessage,
  type AgentPart,
  type AgentToolCall,
  type AgentToolDeclaration,
  type AgentTurnRequest,
  type AgentTurnResponse,
} from './agent-types.ts'

export interface AgentLoopDeps {
  getMessages: () => AgentChatMessage[]
  getProjectContext: () => Record<string, unknown>
  availableTools: AgentToolDeclaration[]
  skills: string
  requestTurn: (request: AgentTurnRequest, signal: AbortSignal) => Promise<AgentTurnResponse>
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  onMessages: (messages: AgentChatMessage[]) => void
  onAskUser: (questions: AgentAskUserQuestion[]) => void
  signal: AbortSignal
}

export type AgentLoopStopReason = 'stop' | 'ask_user' | 'cancelled' | 'error' | 'turn_cap'

export interface AgentLoopResult {
  messages: AgentChatMessage[]
  stopReason: AgentLoopStopReason
  errorCode?: string
  errorMessage?: string
}

function toTurnMessages(messages: AgentChatMessage[]): AgentTurnRequest['messages'] {
  return messages.map(message => ({
    role: message.role,
    parts: message.parts,
  }))
}

function append(messages: AgentChatMessage[], next: AgentChatMessage): AgentChatMessage[] {
  return [...messages, next]
}

export function resolveOrphanToolUses(messages: AgentChatMessage[]): AgentChatMessage[] {
  const pending = new Map<string, { name: string }>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') pending.set(part.id, { name: part.name })
      if (part.type === 'tool_result') pending.delete(part.id)
    }
  }
  if (pending.size === 0) return messages
  const now = Date.now()
  const orphans: AgentChatMessage[] = [...pending.entries()].map(([id, value]) => ({
    id: createAgentMessageId(),
    role: 'tool' as const,
    createdAt: now,
    parts: [{
      type: 'tool_result',
      id,
      name: value.name,
      result: { ok: false, error: 'cancelled' },
    }],
  }))
  return [...messages, ...orphans]
}

export async function runAgentLoop(deps: AgentLoopDeps): Promise<AgentLoopResult> {
  let messages = deps.getMessages()
  let turns = 0

  while (turns < MAX_AGENT_MODEL_TURNS) {
    if (deps.signal.aborted) {
      messages = resolveOrphanToolUses(messages)
      deps.onMessages(messages)
      return { messages, stopReason: 'cancelled' }
    }

    turns += 1
    let response: AgentTurnResponse
    try {
      response = await deps.requestTurn({
        messages: toTurnMessages(messages),
        projectContext: deps.getProjectContext(),
        availableTools: deps.availableTools,
        skills: deps.skills,
      }, deps.signal)
    } catch (error) {
      if (deps.signal.aborted) {
        messages = resolveOrphanToolUses(messages)
        deps.onMessages(messages)
        return { messages, stopReason: 'cancelled' }
      }
      const errorMessage = error instanceof AgentTurnError ? error.message : error instanceof Error ? error.message : 'Agent turn failed'
      const errorCode = error instanceof AgentTurnError ? error.code : undefined
      messages = append(messages, {
        id: createAgentMessageId(),
        role: 'assistant',
        createdAt: Date.now(),
        errorCode,
        parts: [{ type: 'text', text: errorMessage }],
      })
      deps.onMessages(messages)
      return { messages, stopReason: 'error', errorCode, errorMessage }
    }

    if (response.askUser?.length) {
      const parts: AgentPart[] = []
      if (response.text) parts.push({ type: 'text', text: response.text })
      messages = append(messages, {
        id: createAgentMessageId(),
        role: 'assistant',
        createdAt: Date.now(),
        parts: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
      })
      deps.onMessages(messages)
      deps.onAskUser(response.askUser)
      return { messages, stopReason: 'ask_user' }
    }

    if (response.toolCalls.length > 0) {
      const toolCallParts: AgentPart[] = response.toolCalls.map(call => ({
        type: 'tool_call',
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      }))
      if (response.text) toolCallParts.unshift({ type: 'text', text: response.text })
      messages = append(messages, {
        id: createAgentMessageId(),
        role: 'assistant',
        createdAt: Date.now(),
        parts: toolCallParts,
      })
      deps.onMessages(messages)

      for (const call of response.toolCalls) {
        if (deps.signal.aborted) {
          messages = resolveOrphanToolUses(messages)
          deps.onMessages(messages)
          return { messages, stopReason: 'cancelled' }
        }
        const result = await deps.executeTool(call.name, call.arguments)
        messages = append(messages, toolResultMessage(call, result))
        deps.onMessages(messages)
        if (result.needsConfirm === true) {
          deps.onAskUser(confirmQuestionsFromToolResult(result))
          return { messages, stopReason: 'ask_user' }
        }
      }
      continue
    }

    messages = append(messages, {
      id: createAgentMessageId(),
      role: 'assistant',
      createdAt: Date.now(),
      parts: [{ type: 'text', text: response.text || 'Done.' }],
    })
    deps.onMessages(messages)
    return { messages, stopReason: 'stop' }
  }

  messages = append(messages, {
    id: createAgentMessageId(),
    role: 'assistant',
    createdAt: Date.now(),
    parts: [{ type: 'text', text: 'Stopped after the turn cap. Send again to continue.' }],
  })
  deps.onMessages(messages)
  return { messages, stopReason: 'turn_cap' }
}

function toolResultMessage(call: AgentToolCall, result: Record<string, unknown>): AgentChatMessage {
  return {
    id: createAgentMessageId(),
    role: 'tool',
    createdAt: Date.now(),
    parts: [{
      type: 'tool_result',
      id: call.id,
      name: call.name,
      result,
    }],
  }
}

export class AgentTurnError extends Error {
  readonly code?: string
  readonly status: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = 'AgentTurnError'
    this.code = options?.code
    this.status = options?.status ?? 500
  }
}

export function answersToUserMessage(answers: Record<string, string | string[]>): AgentChatMessage {
  const lines = Object.entries(answers).map(([id, value]) => {
    const rendered = Array.isArray(value) ? value.join(', ') : value
    return `- ${id}: ${rendered}`
  })
  return {
    id: createAgentMessageId(),
    role: 'user',
    createdAt: Date.now(),
    parts: [{ type: 'text', text: `Answers:\n${lines.join('\n')}` }],
  }
}
