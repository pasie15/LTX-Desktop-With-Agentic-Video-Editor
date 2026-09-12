import {
  titleFromMessages,
  type AgentChatMessage,
  type AgentChatSession,
  type AgentChatSessionSummary,
} from './agent-types.ts'

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const LOCAL_STORAGE_PREFIX = 'ltx-agent-chats:'

export function isSafeChatSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

export function parseChatSession(raw: unknown): AgentChatSession | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AgentChatSession>
  if (typeof value.id !== 'string' || !isSafeChatSessionId(value.id)) return null
  if (typeof value.title !== 'string') return null
  if (typeof value.updatedAt !== 'number') return null
  if (!Array.isArray(value.messages)) return null
  return {
    id: value.id,
    title: value.title,
    updatedAt: value.updatedAt,
    messages: value.messages as AgentChatMessage[],
  }
}

export function serializeChatSession(session: AgentChatSession): string {
  return JSON.stringify({
    id: session.id,
    title: session.title || titleFromMessages(session.messages),
    updatedAt: session.updatedAt,
    messages: session.messages,
  })
}

export interface AgentChatStorage {
  list(projectId: string): Promise<AgentChatSessionSummary[]>
  read(projectId: string, sessionId: string): Promise<AgentChatSession | null>
  write(projectId: string, session: AgentChatSession): Promise<void>
  remove(projectId: string, sessionId: string): Promise<void>
}

function localStorageKey(projectId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${projectId}`
}

function readLocalIndex(projectId: string): AgentChatSession[] {
  try {
    const raw = localStorage.getItem(localStorageKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseChatSession).filter((item): item is AgentChatSession => item != null)
  } catch {
    return []
  }
}

function writeLocalIndex(projectId: string, sessions: AgentChatSession[]): void {
  localStorage.setItem(localStorageKey(projectId), JSON.stringify(sessions))
}

export const localAgentChatStorage: AgentChatStorage = {
  async list(projectId) {
    return readLocalIndex(projectId)
      .map(session => ({ id: session.id, title: session.title, updatedAt: session.updatedAt }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  },
  async read(projectId, sessionId) {
    return readLocalIndex(projectId).find(session => session.id === sessionId) ?? null
  },
  async write(projectId, session) {
    const next = readLocalIndex(projectId).filter(item => item.id !== session.id)
    next.push(session)
    writeLocalIndex(projectId, next)
  },
  async remove(projectId, sessionId) {
    writeLocalIndex(projectId, readLocalIndex(projectId).filter(item => item.id !== sessionId))
  },
}

function hasElectronChatApi(): boolean {
  const api = window.electronAPI
  return Boolean(
    api
    && 'listProjectChatSessions' in api
    && 'readProjectChatSession' in api
    && 'writeProjectChatSession' in api
    && 'deleteProjectChatSession' in api,
  )
}

export const electronAgentChatStorage: AgentChatStorage = {
  async list(projectId) {
    const result = await window.electronAPI.listProjectChatSessions({ projectId })
    if (!result.success) throw new Error(result.error)
    return result.sessions
  },
  async read(projectId, sessionId) {
    const result = await window.electronAPI.readProjectChatSession({ projectId, sessionId })
    if (!result.success) throw new Error(result.error)
    return parseChatSession(JSON.parse(result.data))
  },
  async write(projectId, session) {
    const result = await window.electronAPI.writeProjectChatSession({
      projectId,
      sessionId: session.id,
      data: serializeChatSession(session),
    })
    if (!result.success) throw new Error(result.error)
  },
  async remove(projectId, sessionId) {
    const result = await window.electronAPI.deleteProjectChatSession({ projectId, sessionId })
    if (!result.success) throw new Error(result.error)
  },
}

export function getAgentChatStorage(): AgentChatStorage {
  return hasElectronChatApi() ? electronAgentChatStorage : localAgentChatStorage
}

export async function loadAgentSessions(
  projectId: string,
  storage: AgentChatStorage = getAgentChatStorage(),
): Promise<AgentChatSession[]> {
  const summaries = await storage.list(projectId)
  const sessions: AgentChatSession[] = []
  for (const summary of summaries) {
    const session = await storage.read(projectId, summary.id)
    if (session) sessions.push(session)
  }
  return sessions.sort((left, right) => right.updatedAt - left.updatedAt)
}
