import {
  AGENT_DEFAULT_PREVIEW_DURATION_S,
  AGENT_DEFAULT_VIDEO_MODEL,
  AGENT_DEFAULT_VIDEO_RESOLUTION,
  type AgentGenerateDestination,
} from './agent-generate-runtime.ts'
import type { AgentAskUserQuestion } from './agent-types.ts'

export const MAX_ASSEMBLY_GENERATE_JOBS = 8

export type AgentAssemblyKind = 'script' | 'broll' | 'music_video' | 'narrative'

export interface AgentAssemblyShot {
  id: string
  prompt: string
  duration: number
  title?: string
  imageAssetId?: string
  refId?: string
  assetId?: string
  skipStill?: boolean
}

export interface AgentAssemblyProposal {
  tool: 'assemble_shots'
  kind: AgentAssemblyKind
  destination: AgentGenerateDestination
  trackIndex: number
  startTime?: number
  model: string
  resolution: string
  audio: boolean
  skipStills: boolean
  jobCount: number
  exceedsJobCap: boolean
  shots: AgentAssemblyShot[]
  voiceover?: string
  voiceoverAssetId?: string
  musicAssetId?: string
  openingTitle?: string
}

const SLUG_PREFIX = /^(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.|SCENE\b|#\s+)/i
const NUMBERED_LINE = /^\d+[\.\)]\s+/
const DURATION_SUFFIX = /\s*[\[(](\d+(?:\.\d+)?)s[\])]\s*$/i

export interface AgentAssemblyPreferredMedia {
  imageAssetId?: string
  musicAssetId?: string
}

export function inferAssemblyMediaFromAssets(
  assets: ReadonlyArray<{
    id: string
    type: string
    prompt?: string
    generationParams?: unknown
  }>,
): AgentAssemblyPreferredMedia {
  const images = assets.filter(asset => (
    asset.type === 'image' && !asset.generationParams
  ))
  const audios = assets.filter(asset => asset.type === 'audio' && !asset.generationParams)
  return {
    ...(images.length === 1 && images[0] ? { imageAssetId: images[0].id } : {}),
    ...(audios.length === 1 && audios[0] ? { musicAssetId: audios[0].id } : {}),
  }
}

export function bindAssemblyUserMedia(
  proposal: AgentAssemblyProposal,
  media: AgentAssemblyPreferredMedia,
): AgentAssemblyProposal {
  const musicAssetId = proposal.musicAssetId ?? media.musicAssetId
  const subjectId = media.imageAssetId
  const shots = proposal.shots.map(shot => {
    if (shot.assetId || shot.imageAssetId || shot.refId || !subjectId) return shot
    return { ...shot, imageAssetId: subjectId, skipStill: true }
  })
  const next = buildAssemblyProposal({
    kind: proposal.kind,
    destination: proposal.destination,
    trackIndex: proposal.trackIndex,
    startTime: proposal.startTime,
    model: proposal.model,
    resolution: proposal.resolution,
    audio: proposal.audio,
    skipStills: proposal.skipStills,
    shots,
    voiceover: proposal.voiceover,
    voiceoverAssetId: proposal.voiceoverAssetId,
    musicAssetId,
    openingTitle: proposal.openingTitle,
  })
  return next
}

export function countAssemblyGenerateJobs(
  shots: readonly AgentAssemblyShot[],
  skipStills: boolean,
): number {
  return shots.reduce((total, shot) => {
    if (shot.assetId) return total
    const still = !skipStills && !shot.skipStill && !shot.imageAssetId
    return total + (still ? 2 : 1)
  }, 0)
}

export function serializeAssemblyShots(shots: readonly AgentAssemblyShot[]): string {
  return shots.map(shot => {
    const title = shot.title?.trim()
    const header = title ? `# ${title}` : `# ${shot.id}`
    return `${header}\n${shot.prompt} [${shot.duration}s]`
  }).join('\n\n')
}

export function parseScriptToShots(script: string): AgentAssemblyShot[] {
  const trimmed = script.trim()
  if (!trimmed) return []

  const blocks = trimmed.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
  if (blocks.length === 1) {
    const lines = splitLines(blocks[0])
    const numbered = lines.filter(line => NUMBERED_LINE.test(line))
    if (numbered.length >= 2) {
      return numbered.map((line, index) => shotFromPrompt(index, line.replace(NUMBERED_LINE, '')))
    }
    if (lines.length > 1 && isSlugLine(lines[0])) {
      return [shotFromBlock(0, lines)]
    }
    return [shotFromPrompt(0, blocks[0])]
  }

  return blocks.map((block, index) => shotFromBlock(index, splitLines(block)))
}

export function normalizeAssemblyShots(raw: unknown): AgentAssemblyShot[] | null {
  if (typeof raw === 'string') return parseScriptToShots(raw)
  if (!Array.isArray(raw)) return null
  const shots: AgentAssemblyShot[] = []
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    const assetId = typeof record.assetId === 'string' && record.assetId.trim()
      ? record.assetId.trim()
      : undefined
    if (!prompt && !assetId) return null
    const duration = typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0
      ? record.duration
      : AGENT_DEFAULT_PREVIEW_DURATION_S
    const id = typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : `shot-${index + 1}`
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined
    const imageAssetId = typeof record.imageAssetId === 'string' && record.imageAssetId.trim()
      ? record.imageAssetId.trim()
      : undefined
    const refId = typeof record.refId === 'string' && record.refId.trim()
      ? record.refId.trim()
      : undefined
    shots.push({
      id,
      prompt: prompt || `Place ${assetId}`,
      duration,
      ...(title ? { title } : {}),
      ...(imageAssetId ? { imageAssetId } : {}),
      ...(refId ? { refId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(record.skipStill === true ? { skipStill: true } : {}),
    })
  }
  return shots
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseAssemblyKind(value: unknown): AgentAssemblyKind {
  if (value === 'broll' || value === 'music_video' || value === 'narrative' || value === 'script') {
    return value
  }
  return 'script'
}

export function buildAssemblyProposal(input: {
  kind?: unknown
  destination?: unknown
  trackIndex?: unknown
  startTime?: unknown
  model?: unknown
  resolution?: unknown
  audio?: unknown
  skipStills?: unknown
  shots: AgentAssemblyShot[]
  voiceover?: unknown
  voiceoverAssetId?: unknown
  musicAssetId?: unknown
  openingTitle?: unknown
  title?: unknown
}): AgentAssemblyProposal {
  const kind = parseAssemblyKind(input.kind)
  const destination = parseDestination(input.destination, kind === 'broll' ? 'after_last' : 'playhead')
  const skipStills = input.skipStills === true
  const jobCount = countAssemblyGenerateJobs(input.shots, skipStills)
  const openingTitle = optionalString(input.openingTitle) ?? optionalString(input.title)
  return {
    tool: 'assemble_shots',
    kind,
    destination,
    trackIndex: typeof input.trackIndex === 'number' && Number.isFinite(input.trackIndex)
      ? input.trackIndex
      : 0,
    ...(typeof input.startTime === 'number' && Number.isFinite(input.startTime)
      ? { startTime: input.startTime }
      : {}),
    model: typeof input.model === 'string' && input.model.trim()
      ? input.model.trim()
      : AGENT_DEFAULT_VIDEO_MODEL,
    resolution: typeof input.resolution === 'string' && input.resolution.trim()
      ? input.resolution.trim()
      : AGENT_DEFAULT_VIDEO_RESOLUTION,
    audio: input.audio === true,
    skipStills,
    jobCount,
    exceedsJobCap: jobCount > MAX_ASSEMBLY_GENERATE_JOBS,
    shots: input.shots,
    ...(optionalString(input.voiceover) ? { voiceover: optionalString(input.voiceover) } : {}),
    ...(optionalString(input.voiceoverAssetId) ? { voiceoverAssetId: optionalString(input.voiceoverAssetId) } : {}),
    ...(optionalString(input.musicAssetId) ? { musicAssetId: optionalString(input.musicAssetId) } : {}),
    ...(openingTitle ? { openingTitle } : {}),
  }
}

export function assemblyConfirmQuestions(proposal: AgentAssemblyProposal): AgentAskUserQuestion[] {
  const extras = [
    proposal.voiceover || proposal.voiceoverAssetId ? 'VO on A1' : null,
    proposal.musicAssetId ? 'music on A2' : null,
    proposal.openingTitle ? 'opening title' : null,
  ].filter(Boolean)
  const extraLabel = extras.length > 0 ? `; ${extras.join(', ')}` : ''
  const jobLabel = `${proposal.shots.length} shot${proposal.shots.length === 1 ? '' : 's'}, ${proposal.jobCount} generate job${proposal.jobCount === 1 ? '' : 's'}${extraLabel}`
  return [{
    id: 'shot_list',
    prompt: proposal.exceedsJobCap
      ? `Shot list (${jobLabel} — over the ${MAX_ASSEMBLY_GENERATE_JOBS}-job cap)`
      : `Shot list (${jobLabel})`,
    kind: 'shot_list',
    options: proposal.exceedsJobCap
      ? [`Proceed with ${proposal.jobCount} sequential generates`, 'Edit']
      : ['Accept', 'Edit'],
    shots: proposal.shots.map(shot => ({
      id: shot.id,
      prompt: shot.prompt,
      duration: shot.duration,
      ...(shot.title ? { title: shot.title } : {}),
      ...(shot.assetId ? { assetId: shot.assetId } : {}),
    })),
  }]
}

export function isAssemblyProceedChoice(value: unknown): boolean {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && text.startsWith('Proceed with ')
}

export function isAssemblyAcceptChoice(value: unknown): boolean {
  const text = Array.isArray(value) ? value[0] : value
  return text === 'Accept' || isAssemblyProceedChoice(text)
}

function parseDestination(value: unknown, fallback: AgentGenerateDestination): AgentGenerateDestination {
  if (value === 'assets' || value === 'playhead' || value === 'gap' || value === 'after_last') {
    return value
  }
  return fallback
}

function splitLines(block: string): string[] {
  return block.split('\n').map(line => line.trim()).filter(Boolean)
}

function isSlugLine(line: string): boolean {
  if (SLUG_PREFIX.test(line) || NUMBERED_LINE.test(line)) return true
  if (line.length < 3 || line.length > 48) return false
  if (/[.!?]$/.test(line)) return false
  const letters = line.replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase()
}

function titleFromSlug(line: string): string {
  return line.replace(SLUG_PREFIX, '').replace(NUMBERED_LINE, '').replace(/^#\s*/, '').trim() || line.trim()
}

function splitDuration(prompt: string): { prompt: string; duration: number } {
  const match = prompt.match(DURATION_SUFFIX)
  if (!match) return { prompt: prompt.trim(), duration: AGENT_DEFAULT_PREVIEW_DURATION_S }
  return {
    prompt: prompt.replace(DURATION_SUFFIX, '').trim(),
    duration: Number(match[1]),
  }
}

function shotFromPrompt(index: number, rawPrompt: string, title?: string): AgentAssemblyShot {
  const parsed = splitDuration(rawPrompt)
  return {
    id: `shot-${index + 1}`,
    prompt: parsed.prompt,
    duration: parsed.duration,
    ...(title ? { title } : {}),
  }
}

function shotFromBlock(index: number, lines: string[]): AgentAssemblyShot {
  const first = lines[0] ?? ''
  if (NUMBERED_LINE.test(first) && lines.length === 1) {
    return shotFromPrompt(index, first.replace(NUMBERED_LINE, ''))
  }
  if (isSlugLine(first) && lines.length > 1) {
    return shotFromPrompt(index, lines.slice(1).join(' '), titleFromSlug(first))
  }
  if (isSlugLine(first) && lines.length === 1) {
    return shotFromPrompt(index, titleFromSlug(first), titleFromSlug(first))
  }
  return shotFromPrompt(index, lines.join(' '))
}
