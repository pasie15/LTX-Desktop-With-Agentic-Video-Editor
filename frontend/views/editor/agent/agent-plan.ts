import {
  parseCharacterBible,
  parseCharacterSheets,
  type AgentCharacterBible,
  type AgentCharacterSheet,
} from './agent-assembly.ts'
import { asString, asStringArray } from './agent-tool-utils.ts'

export interface AgentEditPlanShot {
  id?: string
  prompt?: string
  duration?: number
  title?: string
  firstFramePrompt?: string
  lastFramePrompt?: string
  showProtagonist?: boolean
  wardrobe?: string
  dialogue?: string
  lipSync?: boolean
  performance?: 'singing' | 'talking' | 'dialogue' | 'silent'
  address?: 'solo' | 'to_others' | 'with_others' | 'off_camera'
  performers?: string
  others?: string
  objects?: string
  environment?: string
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
  character?: AgentCharacterBible
  characterSheets?: AgentCharacterSheet[]
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
    if (typeof record.firstFramePrompt === 'string' && record.firstFramePrompt.trim()) {
      shot.firstFramePrompt = record.firstFramePrompt.trim()
    }
    if (typeof record.lastFramePrompt === 'string' && record.lastFramePrompt.trim()) {
      shot.lastFramePrompt = record.lastFramePrompt.trim()
    }
    if (record.showProtagonist === true || record.showProtagonist === false) {
      shot.showProtagonist = record.showProtagonist
    }
    if (typeof record.wardrobe === 'string' && record.wardrobe.trim()) shot.wardrobe = record.wardrobe.trim()
    if (typeof record.dialogue === 'string' && record.dialogue.trim()) shot.dialogue = record.dialogue.trim()
    if (record.lipSync === true) shot.lipSync = true
    if (record.performance === 'singing' || record.performance === 'talking' || record.performance === 'dialogue' || record.performance === 'silent') {
      shot.performance = record.performance
    }
    if (record.address === 'solo' || record.address === 'to_others' || record.address === 'with_others' || record.address === 'off_camera') {
      shot.address = record.address
    }
    if (typeof record.performers === 'string' && record.performers.trim()) shot.performers = record.performers.trim()
    if (typeof record.others === 'string' && record.others.trim()) shot.others = record.others.trim()
    if (typeof record.objects === 'string' && record.objects.trim()) shot.objects = record.objects.trim()
    if (typeof record.environment === 'string' && record.environment.trim()) shot.environment = record.environment.trim()
    if (shot.id || shot.prompt || shot.title) shots.push(shot)
  }
  return shots
}

export function normalizeEditPlan(args: Record<string, unknown>): AgentEditPlan | { error: string } {
  const goal = asString(args.goal) ?? asString(args.brief)
  if (!goal) return { error: 'Missing goal' }
  const character = parseCharacterBible(args.character)
  const characterSheets = parseCharacterSheets(args.characterSheets)
  return {
    goal,
    shots: asShotList(args.shots),
    voStrategy: asString(args.voStrategy) ?? asString(args.voiceover) ?? '',
    refs: asStringArray(args.refs) ?? [],
    titles: asString(args.titles) ?? '',
    mix: asString(args.mix) ?? '',
    timing: asString(args.timing) ?? '',
    checks: asStringArray(args.checks) ?? [],
    ...(character ? { character } : {}),
    ...(characterSheets.length > 0 ? { characterSheets } : {}),
  }
}

export function planFromAssembly(input: {
  goal?: string
  shots?: Array<{
    id?: string
    prompt?: string
    duration?: number
    title?: string
    firstFramePrompt?: string
    lastFramePrompt?: string
    showProtagonist?: boolean
    wardrobe?: string
    dialogue?: string
    lipSync?: boolean
    performance?: 'singing' | 'talking' | 'dialogue' | 'silent'
    address?: 'solo' | 'to_others' | 'with_others' | 'off_camera'
    performers?: string
    others?: string
    objects?: string
    environment?: string
  }>
  voiceover?: string
  voiceoverAssetId?: string
  musicAssetId?: string
  openingTitle?: string
  referenceAssetId?: string
  character?: AgentCharacterBible
  characterSheets?: AgentCharacterSheet[]
}): AgentEditPlan {
  return {
    goal: input.goal || 'Assemble the brief onto the timeline',
    shots: (input.shots ?? []).map(shot => ({
      ...(shot.id ? { id: shot.id } : {}),
      ...(shot.prompt ? { prompt: shot.prompt } : {}),
      ...(shot.duration != null ? { duration: shot.duration } : {}),
      ...(shot.title ? { title: shot.title } : {}),
      ...(shot.firstFramePrompt ? { firstFramePrompt: shot.firstFramePrompt } : {}),
      ...(shot.lastFramePrompt ? { lastFramePrompt: shot.lastFramePrompt } : {}),
      ...(shot.showProtagonist === true || shot.showProtagonist === false
        ? { showProtagonist: shot.showProtagonist }
        : {}),
      ...(shot.wardrobe ? { wardrobe: shot.wardrobe } : {}),
      ...(shot.dialogue ? { dialogue: shot.dialogue } : {}),
      ...(shot.lipSync ? { lipSync: true } : {}),
      ...(shot.performance ? { performance: shot.performance } : {}),
      ...(shot.address ? { address: shot.address } : {}),
      ...(shot.performers ? { performers: shot.performers } : {}),
      ...(shot.others ? { others: shot.others } : {}),
      ...(shot.objects ? { objects: shot.objects } : {}),
      ...(shot.environment ? { environment: shot.environment } : {}),
    })),
    voStrategy: input.voiceover
      ? `ElevenLabs: ${input.voiceover.slice(0, 120)}`
      : input.voiceoverAssetId
        ? `Existing VO asset ${input.voiceoverAssetId}`
        : 'No voiceover',
    refs: input.referenceAssetId ? [input.referenceAssetId] : [],
    titles: input.openingTitle ?? '',
    mix: input.musicAssetId ? `Music ${input.musicAssetId} on A2 at 0.25` : 'VO on A1 if present',
    timing: 'Character sheet and start frames first; videos last. VO duration drives picture; check_cut after place',
    checks: ['check_cut', 'get_timeline'],
    ...(input.character ? { character: input.character } : {}),
    ...(input.characterSheets && input.characterSheets.length > 0
      ? { characterSheets: input.characterSheets }
      : {}),
  }
}
