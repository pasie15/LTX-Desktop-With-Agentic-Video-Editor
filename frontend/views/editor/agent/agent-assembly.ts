import {
  AGENT_DEFAULT_PREVIEW_DURATION_S,
  AGENT_DEFAULT_VIDEO_MODEL,
  AGENT_DEFAULT_VIDEO_RESOLUTION,
  type AgentGenerateDestination,
} from './agent-generate-runtime.ts'
import { normalizeTextOverlays, type AgentTextOverlay } from './agent-text.ts'
import type { AgentAskUserQuestion } from './agent-types.ts'
import { collectIdentityStillIds, withoutIdentityStartFrames } from './agent-identity.ts'

export const MAX_ASSEMBLY_GENERATE_JOBS = 8

export type AgentAssemblyKind = 'script' | 'broll' | 'music_video' | 'narrative'
export type AgentShotPerformance = 'singing' | 'talking' | 'dialogue' | 'silent'
export type AgentShotAddress = 'solo' | 'to_others' | 'with_others' | 'off_camera'

export interface AgentAssemblyShot {
  id: string
  prompt: string
  duration: number
  title?: string
  firstFramePrompt?: string
  lastFramePrompt?: string
  imageAssetId?: string
  lastImageAssetId?: string
  refId?: string
  assetId?: string
  skipStill?: boolean
  showProtagonist?: boolean
  wardrobe?: string
  dialogue?: string
  lipSync?: boolean
  performance?: AgentShotPerformance
  address?: AgentShotAddress
  performers?: string
  others?: string
  objects?: string
  environment?: string
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
  referenceAssetId?: string
  overlays?: AgentTextOverlay[]
}

const SLUG_PREFIX = /^(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.|SCENE\b|#\s+)/i
const NUMBERED_LINE = /^\d+[\.\)]\s+/
const DURATION_SUFFIX = /\s*[\[(](\d+(?:\.\d+)?)s[\])]\s*$/i

export interface AgentAssemblyPreferredMedia {
  /** @deprecated Portrait stills are character refs, not start frames. Use referenceAssetId. */
  imageAssetId?: string
  referenceAssetId?: string
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
    ...(images.length === 1 && images[0] ? { referenceAssetId: images[0].id } : {}),
    ...(audios.length === 1 && audios[0] ? { musicAssetId: audios[0].id } : {}),
  }
}

export function preferredReferenceAssetId(media: AgentAssemblyPreferredMedia): string | undefined {
  return media.referenceAssetId ?? media.imageAssetId
}

export function shotShowsProtagonist(shot: Pick<AgentAssemblyShot, 'showProtagonist' | 'refId'>): boolean {
  if (shot.showProtagonist === false) return false
  if (shot.showProtagonist === true || shot.refId) return true
  return false
}

export function bindAssemblyUserMedia(
  proposal: AgentAssemblyProposal,
  media: AgentAssemblyPreferredMedia,
): AgentAssemblyProposal {
  const musicAssetId = proposal.musicAssetId ?? media.musicAssetId
  const referenceAssetId = proposal.referenceAssetId ?? preferredReferenceAssetId(media)
  const identityIds = collectIdentityStillIds({
    referenceAssetId,
    preferred: media,
  })
  return buildAssemblyProposal({
    kind: proposal.kind,
    destination: proposal.destination,
    trackIndex: proposal.trackIndex,
    startTime: proposal.startTime,
    model: proposal.model,
    resolution: proposal.resolution,
    audio: proposal.audio,
    skipStills: proposal.skipStills,
    shots: proposal.shots.map(shot => withoutIdentityStartFrames(shot, identityIds)),
    voiceover: proposal.voiceover,
    voiceoverAssetId: proposal.voiceoverAssetId,
    musicAssetId,
    openingTitle: proposal.openingTitle,
    referenceAssetId,
    overlays: proposal.overlays,
  })
}

export function countAssemblyGenerateJobs(
  shots: readonly AgentAssemblyShot[],
  skipStills: boolean,
): number {
  return shots.reduce((total, shot) => {
    if (shot.assetId) return total
    const first = !skipStills && !shot.skipStill && !shot.imageAssetId
    const last = !skipStills && Boolean(shot.lastFramePrompt) && !shot.lastImageAssetId
    return total + (first ? 1 : 0) + (last ? 1 : 0) + 1
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
    const firstFramePrompt = optionalString(record.firstFramePrompt)
    const lastFramePrompt = optionalString(record.lastFramePrompt)
    const lastImageAssetId = optionalString(record.lastImageAssetId)
    const wardrobe = optionalString(record.wardrobe)
    const dialogue = optionalString(record.dialogue)
    const performance = parseShotPerformance(record.performance)
    const address = parseShotAddress(record.address)
    const performers = optionalString(record.performers)
    const others = optionalString(record.others)
    const objects = optionalString(record.objects)
    const environment = optionalString(record.environment)
    const lipSync = record.lipSync === true
      || (record.lipSync !== false && shotImpliesOnCameraVoice({
        performance,
        address,
        showProtagonist: record.showProtagonist === true || record.showProtagonist === false
          ? record.showProtagonist
          : undefined,
        refId,
      }))
    shots.push({
      id,
      prompt: prompt || `Place ${assetId}`,
      duration,
      ...(title ? { title } : {}),
      ...(firstFramePrompt ? { firstFramePrompt } : {}),
      ...(lastFramePrompt ? { lastFramePrompt } : {}),
      ...(imageAssetId ? { imageAssetId } : {}),
      ...(lastImageAssetId ? { lastImageAssetId } : {}),
      ...(refId ? { refId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(record.skipStill === true ? { skipStill: true } : {}),
      ...(record.showProtagonist === true || record.showProtagonist === false
        ? { showProtagonist: record.showProtagonist }
        : {}),
      ...(wardrobe ? { wardrobe } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(lipSync ? { lipSync: true } : {}),
      ...(performance ? { performance } : {}),
      ...(address ? { address } : {}),
      ...(performers ? { performers } : {}),
      ...(others ? { others } : {}),
      ...(objects ? { objects } : {}),
      ...(environment ? { environment } : {}),
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
  referenceAssetId?: unknown
  overlays?: unknown
  lyrics?: unknown
}): AgentAssemblyProposal {
  const kind = parseAssemblyKind(input.kind)
  const destination = parseDestination(input.destination, kind === 'broll' ? 'after_last' : 'playhead')
  const skipStills = input.skipStills === true
  const jobCount = countAssemblyGenerateJobs(input.shots, skipStills)
  const openingTitle = optionalString(input.openingTitle) ?? optionalString(input.title)
  const overlays = [
    ...normalizeTextOverlays(input.overlays),
    ...normalizeTextOverlays(input.lyrics),
  ]
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
    ...(optionalString(input.referenceAssetId) ? { referenceAssetId: optionalString(input.referenceAssetId) } : {}),
    ...(overlays.length > 0 ? { overlays } : {}),
  }
}

export function assemblyConfirmQuestions(proposal: AgentAssemblyProposal): AgentAskUserQuestion[] {
  const extras = [
    proposal.voiceover || proposal.voiceoverAssetId ? 'VO on A1' : null,
    proposal.musicAssetId ? 'music on A2' : null,
    proposal.openingTitle ? 'opening title' : null,
    proposal.overlays?.some(item => item.role === 'lyrics') ? 'lyrics on V2' : null,
    proposal.overlays?.some(item => item.role !== 'lyrics') ? 'text overlays' : null,
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

export function stillPromptForShot(shot: AgentAssemblyShot, which: 'first' | 'last' = 'first'): string {
  const base = which === 'last'
    ? (shot.lastFramePrompt ?? shot.prompt)
    : (shot.firstFramePrompt ?? shot.prompt)
  return withScenePromptExtras(base, shot, which)
}

export function videoPromptForShot(shot: AgentAssemblyShot): string {
  return withScenePromptExtras(shot.prompt, shot, 'video')
}

export function shotImpliesOnCameraVoice(shot: Pick<AgentAssemblyShot, 'performance' | 'address' | 'showProtagonist' | 'refId' | 'lipSync'>): boolean {
  if (shot.lipSync === true) return true
  if (shot.address === 'off_camera' || shot.showProtagonist === false) return false
  return shot.performance === 'singing' || shot.performance === 'talking' || shot.performance === 'dialogue'
}

function parseShotPerformance(value: unknown): AgentShotPerformance | undefined {
  if (value === 'singing' || value === 'talking' || value === 'dialogue' || value === 'silent') return value
  return undefined
}

function parseShotAddress(value: unknown): AgentShotAddress | undefined {
  if (value === 'solo' || value === 'to_others' || value === 'with_others' || value === 'off_camera') return value
  return undefined
}

function withScenePromptExtras(
  base: string,
  shot: AgentAssemblyShot,
  which: 'first' | 'last' | 'video',
): string {
  const extras: string[] = []
  if (shot.environment) extras.push(`Setting: ${shot.environment}`)
  if (shot.objects) extras.push(`Stage objects: ${shot.objects}`)
  if (shot.wardrobe) extras.push(`Wardrobe: ${shot.wardrobe}`)
  if (shot.showProtagonist === false) extras.push('Do not show the protagonist. Environment, extras, or objects only.')
  else if (shotShowsProtagonist(shot)) extras.push('Match the registered character identity; stage this beat, do not copy the reference portrait as the frame.')
  if (shot.performers) extras.push(`On camera: ${shot.performers}`)
  if (shot.others) extras.push(`Others in the scene: ${shot.others}`)
  const performance = scenePerformanceLine(shot, which)
  if (performance) extras.push(performance)
  return extras.length > 0 ? `${base} ${extras.join(' ')}` : base
}

function scenePerformanceLine(shot: AgentAssemblyShot, which: 'first' | 'last' | 'video'): string | undefined {
  const onCamera = shotImpliesOnCameraVoice(shot)
  const who = shot.performers || (shotShowsProtagonist(shot) ? 'the protagonist' : 'the performer')
  const toward = shot.others
    ? (shot.address === 'with_others' ? `with ${shot.others}` : `to ${shot.others}`)
    : shot.address === 'to_others' || shot.address === 'with_others'
      ? 'to someone else in the scene'
      : 'alone'
  if (shot.performance === 'silent' || (!shot.performance && !shot.dialogue && !onCamera)) {
    if (shot.showProtagonist === false) return undefined
    return 'No singing or talking. Faces closed; action and environment carry the beat.'
  }
  if (shot.performance === 'singing') {
    if (which !== 'video') return onCamera ? `Mouth beginning to sing ${toward}.` : 'No on-camera singing; environment or listener reaction.'
    return onCamera
      ? `On-camera singing with lip sync ${toward}: ${shot.dialogue ? `"${shot.dialogue}"` : who}`
      : `Off-camera singing ${toward}${shot.dialogue ? `: "${shot.dialogue}"` : ''}`
  }
  if (shot.performance === 'dialogue') {
    if (which !== 'video') return onCamera ? `Mouth beginning a conversation ${toward}.` : 'Listen / react; do not speak on camera.'
    return onCamera
      ? `On-camera dialogue with lip sync ${toward}: ${shot.dialogue ? `"${shot.dialogue}"` : who}`
      : `Off-camera dialogue ${toward}${shot.dialogue ? `: "${shot.dialogue}"` : ''}`
  }
  if (shot.performance === 'talking' || shot.dialogue) {
    if (which !== 'video') {
      return onCamera ? 'Mouth beginning the spoken line.' : 'No on-camera speech.'
    }
    return onCamera
      ? `On-camera speech with lip sync ${toward}: ${shot.dialogue ? `"${shot.dialogue}"` : who}`
      : `Spoken/off-camera line (no lip sync)${shot.dialogue ? `: "${shot.dialogue}"` : ''}`
  }
  return undefined
}
