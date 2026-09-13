import { asString, asStringArray } from './agent-tool-utils.ts'

export interface AgentEditPlanShot {
  id?: string
  prompt?: string
  duration?: number
  title?: string
}

export interface AgentEditPlan {
  goal: string
  shots: AgentEditPlanShot[]
  voStrategy: string
  refs: string[]
  titles: string
  mix: string
  timing: string
  checks: string[]
}

function asShotList(raw: unknown): AgentEditPlanShot[] {
  if (!Array.isArray(raw)) return []
  const shots: AgentEditPlanShot[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      shots.push({ prompt: item.trim() })
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const shot: AgentEditPlanShot = {}
    if (typeof record.id === 'string' && record.id.trim()) shot.id = record.id.trim()
    if (typeof record.prompt === 'string' && record.prompt.trim()) shot.prompt = record.prompt.trim()
    if (typeof record.title === 'string' && record.title.trim()) shot.title = record.title.trim()
    if (typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0) {
      shot.duration = record.duration
    }
    if (shot.id || shot.prompt || shot.title) shots.push(shot)
  }
  return shots
}

export function normalizeEditPlan(args: Record<string, unknown>): AgentEditPlan | { error: string } {
  const goal = asString(args.goal) ?? asString(args.brief)
  if (!goal) return { error: 'Missing goal' }
  return {
    goal,
    shots: asShotList(args.shots),
    voStrategy: asString(args.voStrategy) ?? asString(args.voiceover) ?? '',
    refs: asStringArray(args.refs) ?? [],
    titles: asString(args.titles) ?? '',
    mix: asString(args.mix) ?? '',
    timing: asString(args.timing) ?? '',
    checks: asStringArray(args.checks) ?? [],
  }
}

export function planFromAssembly(input: {
  goal?: string
  shots?: Array<{ id?: string; prompt?: string; duration?: number; title?: string }>
  voiceover?: string
  voiceoverAssetId?: string
  musicAssetId?: string
  openingTitle?: string
}): AgentEditPlan {
  return {
    goal: input.goal || 'Assemble the brief onto the timeline',
    shots: (input.shots ?? []).map(shot => ({
      ...(shot.id ? { id: shot.id } : {}),
      ...(shot.prompt ? { prompt: shot.prompt } : {}),
      ...(shot.duration != null ? { duration: shot.duration } : {}),
      ...(shot.title ? { title: shot.title } : {}),
    })),
    voStrategy: input.voiceover
      ? `ElevenLabs: ${input.voiceover.slice(0, 120)}`
      : input.voiceoverAssetId
        ? `Existing VO asset ${input.voiceoverAssetId}`
        : 'No voiceover',
    refs: [],
    titles: input.openingTitle ?? '',
    mix: input.musicAssetId ? `Music ${input.musicAssetId} on A2 at 0.25` : 'VO on A1 if present',
    timing: 'VO duration drives picture; check_cut after place',
    checks: ['check_cut', 'get_timeline'],
  }
}
