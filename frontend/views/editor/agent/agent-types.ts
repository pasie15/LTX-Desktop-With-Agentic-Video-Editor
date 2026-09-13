export const MAX_AGENT_MODEL_TURNS = 16
export const AGENT_TIMELINE_WINDOW_S = 30
export const AGENT_ADD_MENTION_EVENT = 'agent-add-mention'

export type AgentRole = 'user' | 'assistant' | 'tool'

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'inline_image'; mimeType: string; data: string; name?: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: Record<string, unknown> }

export interface AgentChatMessage {
  id: string
  role: AgentRole
  parts: AgentPart[]
  createdAt: number
  errorCode?: string
}

export interface AgentAskUserShot {
  id: string
  prompt: string
  duration: number
  title?: string
  assetId?: string
}

export interface AgentAskUserQuestion {
  id: string
  prompt: string
  kind: 'choice' | 'text' | 'shot_list'
  options?: string[]
  allowMultiple?: boolean
  shots?: AgentAskUserShot[]
}

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AgentToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AgentTurnRequest {
  messages: Array<{
    role: AgentRole
    parts: AgentPart[]
  }>
  projectContext: Record<string, unknown>
  availableTools: AgentToolDeclaration[]
  skills?: string
  model?: string
}

export interface AgentTurnResponse {
  status: 'success'
  text: string
  toolCalls: AgentToolCall[]
  askUser: AgentAskUserQuestion[] | null
  finishReason: 'stop' | 'tool_calls' | 'ask_user'
}

export type AgentMentionKind = 'asset' | 'selection' | 'range'

export interface AgentMention {
  kind: AgentMentionKind
  id: string
  label: string
  assetId?: string
  assetType?: string
  clipIds?: string[]
  inPoint?: number
  outPoint?: number
}

export interface AgentChatSession {
  id: string
  title: string
  updatedAt: number
  messages: AgentChatMessage[]
}

export interface AgentChatSessionSummary {
  id: string
  title: string
  updatedAt: number
}

export interface AgentProjectSnapshot {
  project: { id: string; name: string }
  assets: Array<{
    id: string
    type: string
    name: string
    duration?: number
    resolution?: string
    bin?: string
    favorite?: boolean
    prompt?: string
  }>
  timelines: Array<{
    id: string
    name: string
    clipCount: number
    duration: number
    active?: boolean
  }>
  activeTimeline: {
    id: string
    name: string
    duration: number
    windowed: boolean
    tracks: Array<{
      id: string
      name: string
      kind?: string
      locked: boolean
      muted: boolean
    }>
    clips: Array<{
      id: string
      assetId: string | null
      track: number
      start: number
      duration: number
      type: string
    }>
    subtitleCount: number
    gaps: Array<{ trackIndex: number; start: number; end: number }>
  } | null
  session: {
    playhead: number
    inPoint: number | null
    outPoint: number | null
    selectedClipIds: string[]
    selectedGap: { trackIndex: number; start: number; end: number } | null
  }
  generation: {
    busy: boolean
    canCancel: boolean
    currentModelLabel: string
  }
  refs: Array<{
    id: string
    name: string
    role: string
    assetId: string
  }>
}

export interface AgentGenerationProgress {
  toolName: string
  percent: number
  status: string
}

export interface AgentAddMentionDetail {
  mention: AgentMention
}

export function isAgentAddMentionEvent(event: Event): event is CustomEvent<AgentAddMentionDetail> {
  return event instanceof CustomEvent && event.type === AGENT_ADD_MENTION_EVENT
}

export function dispatchAgentMention(mention: AgentMention): void {
  window.dispatchEvent(new CustomEvent<AgentAddMentionDetail>(AGENT_ADD_MENTION_EVENT, {
    detail: { mention },
  }))
}

export function createAgentMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createAgentSessionId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function titleFromMessages(messages: AgentChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type !== 'text') continue
      const line = part.text.trim().split('\n')[0]?.trim()
      if (line) return line.slice(0, 80)
    }
  }
  return 'New chat'
}

export function formatAgentTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const minutes = Math.floor(clamped / 60)
  const remainder = clamped - minutes * 60
  const whole = Math.floor(remainder)
  const tenth = Math.round((remainder - whole) * 10)
  const normalizedTenth = tenth === 10 ? 0 : tenth
  const normalizedWhole = tenth === 10 ? whole + 1 : whole
  return `${minutes}:${String(normalizedWhole).padStart(2, '0')}.${normalizedTenth}`
}
