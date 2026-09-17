import {
  assemblyConfirmQuestionsFromResult,
} from './agent-assembly-runtime.ts'
import {
  buildAssemblyProposal,
  normalizeAssemblyShots,
  type AgentAssemblyProposal,
} from './agent-assembly.ts'
import { confirmQuestionsFromToolResult } from './agent-generate-runtime.ts'
import { reviewQuestionsFromResult } from './agent-approvals.ts'
import { normalizeEditPlan, type AgentEditPlan } from './agent-plan.ts'
import type { AgentAssemblyProgress } from './agent-assembly-runtime.ts'
import type {
  AgentAskUserQuestion,
  AgentChatMessage,
  AgentChatSession,
  AgentConversationCheckpoint,
  AgentSessionMemory,
} from './agent-types.ts'

export interface HydratedAgentMemory {
  plan: AgentEditPlan | null
  assemblyProposal: AgentAssemblyProposal | null
  assemblyProgress: AgentAssemblyProgress | null
  assemblyConfirmedMore: boolean
  pendingAskUser: AgentAskUserQuestion[] | null
}

const ASSEMBLY_STAGES = new Set(['character_sheet', 'still', 'video'])

function lastTextForRole(messages: readonly AgentChatMessage[], role: AgentChatMessage['role']): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== role) continue
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) return part.text.trim()
    }
  }
  return ''
}

export function lastUserText(messages: readonly AgentChatMessage[]): string {
  return lastTextForRole(messages, 'user')
}

export function lastAssistantText(messages: readonly AgentChatMessage[]): string {
  return lastTextForRole(messages, 'assistant')
}

export function countUserTurns(messages: readonly AgentChatMessage[]): number {
  return messages.filter(message => message.role === 'user').length
}

export function parseHydratedMemory(raw: AgentSessionMemory | undefined): HydratedAgentMemory {
  const plan = raw?.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan)
    ? normalizeEditPlan(raw.plan as Record<string, unknown>)
    : null
  return {
    plan: plan && !('error' in plan) ? plan : null,
    assemblyProposal: parseAssemblyProposal(raw?.assemblyProposal),
    assemblyProgress: parseAssemblyProgress(raw?.assemblyProgress),
    assemblyConfirmedMore: raw?.assemblyConfirmedMore === true,
    pendingAskUser: Array.isArray(raw?.pendingAskUser) ? raw.pendingAskUser : null,
  }
}

export function serializeHydratedMemory(memory: HydratedAgentMemory): AgentSessionMemory | undefined {
  if (
    !memory.plan
    && !memory.assemblyProposal
    && !memory.assemblyProgress
    && !memory.assemblyConfirmedMore
    && !memory.pendingAskUser?.length
  ) {
    return undefined
  }
  return {
    ...(memory.plan ? { plan: memory.plan } : {}),
    ...(memory.assemblyProposal ? { assemblyProposal: memory.assemblyProposal } : {}),
    ...(memory.assemblyProgress ? { assemblyProgress: memory.assemblyProgress } : {}),
    ...(memory.assemblyConfirmedMore ? { assemblyConfirmedMore: true } : {}),
    ...(memory.pendingAskUser?.length ? { pendingAskUser: memory.pendingAskUser } : {}),
  }
}

export function pendingQuestionsFromMessages(messages: readonly AgentChatMessage[]): AgentAskUserQuestion[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'tool') continue
    for (const part of message.parts) {
      if (part.type !== 'tool_result') continue
      const result = part.result
      if (result.needsConfirm === true) {
        return assemblyConfirmQuestionsFromResult(result) ?? confirmQuestionsFromToolResult(result)
      }
      if (result.needsReview === true) {
        return reviewQuestionsFromResult(result)
      }
    }
  }
  return null
}

export function conversationCheckpoint(input: {
  messages: readonly AgentChatMessage[]
  assemblyStage?: string
  assemblyShotIndex?: number
  awaitingUser?: boolean
}): AgentConversationCheckpoint {
  const userTurns = countUserTurns(input.messages)
  const lastUser = lastUserText(input.messages)
  const lastAssistant = lastAssistantText(input.messages)
  return {
    continued: userTurns > 1,
    userTurns,
    ...(lastUser ? { lastUserText: lastUser.slice(0, 240) } : {}),
    ...(lastAssistant ? { lastAssistantText: lastAssistant.slice(0, 240) } : {}),
    ...(input.assemblyStage
      ? {
          assemblyStage: input.assemblyStage,
          ...(typeof input.assemblyShotIndex === 'number' ? { assemblyShotIndex: input.assemblyShotIndex } : {}),
        }
      : {}),
    ...(input.awaitingUser ? { awaitingUser: true } : {}),
  }
}

export function restorePendingAskUser(session: Pick<AgentChatSession, 'messages' | 'memory'>): AgentAskUserQuestion[] | null {
  const last = lastUserText(session.messages)
  if (/^Answers:/m.test(last) || /Approve all — continue/.test(last)) return null
  const stored = parseHydratedMemory(session.memory).pendingAskUser
  if (stored?.length) return stored
  return pendingQuestionsFromMessages(session.messages)
}

function parseAssemblyProposal(raw: unknown): AgentAssemblyProposal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const shots = normalizeAssemblyShots(record.shots)
  if (!shots || shots.length === 0) return null
  return buildAssemblyProposal({ ...record, shots })
}

function parseAssemblyProgress(raw: unknown): AgentAssemblyProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.stage !== 'string' || !ASSEMBLY_STAGES.has(record.stage)) return null
  if (typeof record.shotIndex !== 'number' || !Number.isFinite(record.shotIndex)) return null
  if (typeof record.cursor !== 'number' || !Number.isFinite(record.cursor)) return null
  if (!Array.isArray(record.placed) || !Array.isArray(record.checklist)) return null
  return record as unknown as AgentAssemblyProgress
}
