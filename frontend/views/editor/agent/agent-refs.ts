export const AGENT_REFS_CHANGED_EVENT = 'agent-refs-changed'
export const AGENT_REF_ROLES = ['character', 'object', 'location', 'style'] as const
const LOCAL_STORAGE_PREFIX = 'ltx-agent-refs:'
const REF_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export type AgentRefRole = (typeof AGENT_REF_ROLES)[number]

export interface AgentRef {
  id: string
  name: string
  role: AgentRefRole
  assetId: string
}

export interface AgentRefStore {
  list(): AgentRef[]
  register(input: { name: string; assetId: string; role?: string; id?: string }): AgentRef
  forget(id: string): boolean
  resolveImageAssetId(refId: string): string | null
}

export function isAgentRefRole(value: unknown): value is AgentRefRole {
  return typeof value === 'string' && (AGENT_REF_ROLES as readonly string[]).includes(value)
}

export function createAgentRefId(): string {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function parseAgentRef(raw: unknown): AgentRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' && REF_ID_PATTERN.test(value.id) ? value.id : null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const assetId = typeof value.assetId === 'string' ? value.assetId.trim() : ''
  const role = isAgentRefRole(value.role) ? value.role : 'character'
  if (!id || !name || !assetId) return null
  return { id, name, role, assetId }
}

export function parseAgentRefs(raw: unknown): AgentRef[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parseAgentRef).filter((item): item is AgentRef => item != null)
}

export function compactAgentRefs(refs: readonly AgentRef[]): AgentRef[] {
  return refs.map(ref => ({
    id: ref.id,
    name: ref.name,
    role: ref.role,
    assetId: ref.assetId,
  }))
}

export function resolveRefImageAssetId(refs: readonly AgentRef[], refId: string): string | null {
  const match = refs.find(ref => ref.id === refId)
  return match?.assetId ?? null
}

function localStorageKey(projectId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${projectId}`
}

function readLocalRefs(projectId: string): AgentRef[] {
  try {
    const raw = localStorage.getItem(localStorageKey(projectId))
    if (!raw) return []
    return parseAgentRefs(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

function writeLocalRefs(projectId: string, refs: AgentRef[]): void {
  localStorage.setItem(localStorageKey(projectId), JSON.stringify(refs))
}

function notifyRefsChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(AGENT_REFS_CHANGED_EVENT, { detail: { projectId } }))
}

function hasElectronRefsApi(): boolean {
  const api = window.electronAPI
  return Boolean(api && 'readProjectRefs' in api && 'writeProjectRefs' in api)
}

export function createMemoryRefStore(initial: AgentRef[] = []): AgentRefStore {
  let refs = compactAgentRefs(initial)
  return {
    list: () => compactAgentRefs(refs),
    register(input) {
      const existing = input.id ? refs.find(ref => ref.id === input.id) : undefined
      const next: AgentRef = {
        id: existing?.id ?? (input.id && REF_ID_PATTERN.test(input.id) ? input.id : createAgentRefId()),
        name: input.name.trim(),
        role: isAgentRefRole(input.role) ? input.role : existing?.role ?? 'character',
        assetId: input.assetId.trim(),
      }
      refs = [next, ...refs.filter(ref => ref.id !== next.id && ref.assetId !== next.assetId)]
      return next
    },
    forget(id) {
      const before = refs.length
      refs = refs.filter(ref => ref.id !== id)
      return refs.length !== before
    },
    resolveImageAssetId(refId) {
      return resolveRefImageAssetId(refs, refId)
    },
  }
}

const projectStores = new Map<string, AgentRefStore>()

export function getProjectRefStore(projectId: string): AgentRefStore {
  const existing = projectStores.get(projectId)
  if (existing) return existing
  const created = createProjectRefStore(projectId)
  projectStores.set(projectId, created)
  return created
}

export function createProjectRefStore(projectId: string): AgentRefStore {
  const persist = (refs: AgentRef[]) => {
    writeLocalRefs(projectId, refs)
    if (hasElectronRefsApi()) {
      void window.electronAPI.writeProjectRefs({
        projectId,
        data: JSON.stringify(refs),
      }).catch(() => {})
    }
    notifyRefsChanged(projectId)
  }

  const memory = createMemoryRefStore(readLocalRefs(projectId))
  if (hasElectronRefsApi()) {
    void window.electronAPI.readProjectRefs({ projectId }).then(result => {
      if (!result.success || !result.data) return
      const loaded = parseAgentRefs(JSON.parse(result.data) as unknown)
      if (loaded.length === 0) return
      for (const ref of [...loaded].reverse()) memory.register(ref)
      writeLocalRefs(projectId, memory.list())
      notifyRefsChanged(projectId)
    }).catch(() => {})
  }

  return {
    list: () => memory.list(),
    register(input) {
      const next = memory.register(input)
      persist(memory.list())
      return next
    },
    forget(id) {
      const removed = memory.forget(id)
      if (removed) persist(memory.list())
      return removed
    },
    resolveImageAssetId: refId => memory.resolveImageAssetId(refId),
  }
}
