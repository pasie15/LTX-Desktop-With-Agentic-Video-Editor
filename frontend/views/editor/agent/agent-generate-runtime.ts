import type { Asset, AssetTake, GenerationParams } from '../../../types/project-model.ts'
import type { EditorState, TimelineGapSelection } from '../editor-state.ts'
import {
  checkpointFromGenerate,
  nextStepForCheckpoint,
  type AgentReviewPreview,
} from './agent-approvals.ts'
import { AGENT_DEFAULT_REF_STRENGTH } from './agent-mix.ts'
import type { AgentRefStore } from './agent-refs.ts'
import type { AgentAskUserQuestion } from './agent-types.ts'
import {
  asBoolean,
  asNumber,
  asString,
  toolErrorResult,
  validateUnknownKeys,
} from './agent-tool-utils.ts'
import {
  GENERATION_SLOT_WAIT_STATUS,
  slotWaitError,
  waitForGenerationSlot,
  type GenerationSlotWaitResult,
} from './agent-generation-slot.ts'
import {
  GENERATE_TOOL_ALLOWED_KEYS,
  type AgentGenerateToolName,
} from './tool-definitions.ts'
import {
  collectIdentityStillIds,
  firstIdentityStillId,
  isIdentityStillId,
  isImportedStill,
  type IdentityPreferredMedia,
} from './agent-identity.ts'

export const AGENT_DEFAULT_PREVIEW_DURATION_S = 4
export const AGENT_DEFAULT_VIDEO_MODEL = 'fast'
export const AGENT_DEFAULT_VIDEO_RESOLUTION = '540p'
export const AGENT_DEFAULT_IMAGE_RESOLUTION = '1080p'
export const AGENT_DEFAULT_ASPECT_RATIO = '16:9'

const GENERATE_DESTINATIONS = ['assets', 'playhead', 'gap', 'after_last'] as const
export type AgentGenerateDestination = (typeof GENERATE_DESTINATIONS)[number]

export interface AgentGenerateSettings {
  model: string
  duration: number
  videoResolution: string
  fps: number
  audio: boolean
  cameraMotion: string
  aspectRatio: string
  imageResolution: string
  imageAspectRatio: string
  imageSteps: number
}

export type AgentGenerateJobResult =
  | { status: 'complete'; path: string; paths?: string[] }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }

export interface AgentPersistedVisualAsset {
  path: string
  bigThumbnailPath: string
  smallThumbnailPath: string
  width: number
  height: number
}

export interface AgentGenerationJobs {
  isBusy: () => boolean
  waitForSlot?: (input: {
    signal?: AbortSignal
    onWaiting?: () => void
  }) => Promise<GenerationSlotWaitResult>
  runImage: (input: {
    prompt: string
    settings: AgentGenerateSettings
    imagePath?: string | null
    strength?: number
    signal?: AbortSignal
    onProgress?: (progress: { percent: number; status: string }) => void
  }) => Promise<AgentGenerateJobResult>
  runVideo: (input: {
    prompt: string
    imagePath: string | null
    lastImagePath?: string | null
    settings: AgentGenerateSettings
    signal?: AbortSignal
    onProgress?: (progress: { percent: number; status: string }) => void
  }) => Promise<AgentGenerateJobResult>
  enhancePrompt: (
    prompt: string,
    mediaType: 'image' | 'video',
  ) => Promise<{ ok: true; prompt: string } | { ok: false; error: string }>
  cancel: () => void
  persistVisualAsset: (srcPath: string, type: 'video' | 'image') => Promise<AgentPersistedVisualAsset | null>
}

export interface AgentGenerateActionHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  actions: {
    addAssetToEditor: (state: EditorState, asset: Asset) => EditorState
    insertAssetsToTimeline: (state: EditorState, params: { assets: Asset[]; trackIndex?: number; startTime?: number }) => EditorState
    insertGeneratedGapAsset: (state: EditorState, params: {
      gap: TimelineGapSelection
      asset: Asset
      createAudio: boolean
    }) => EditorState
    applyGeneratedTake: (state: EditorState, assetId: string, take: AssetTake, clipId?: string) => EditorState
  }
  generation?: AgentGenerationJobs
  getSelectedGap?: () => TimelineGapSelection | null
  getAbortSignal?: () => AbortSignal | null
  onProgress?: (progress: { toolName: string; percent: number; status: string }) => void
  refs?: AgentRefStore
  getPreferredAssemblyMedia?: () => IdentityPreferredMedia
  getApproveAll?: () => boolean
  readAssetPreview?: (asset: Asset) => Promise<AgentReviewPreview | null>
}

export interface AgentGenerateProposal {
  tool: AgentGenerateToolName
  prompt?: string
  model?: string
  duration?: number
  resolution?: string
  audio?: boolean
  destination?: AgentGenerateDestination
  imageAssetId?: string
  lastImageAssetId?: string
  clipId?: string
  assetId?: string
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

export async function waitForHostGenerationSlot(
  host: AgentGenerateActionHost,
  toolName: string,
): Promise<Record<string, unknown> | null> {
  const jobs = host.generation
  if (!jobs) return errorResult('Generation is not available')
  const signal = host.getAbortSignal?.() ?? undefined
  const onWaiting = () => {
    host.onProgress?.({
      toolName,
      percent: 0,
      status: GENERATION_SLOT_WAIT_STATUS,
    })
  }
  const result = jobs.waitForSlot
    ? await jobs.waitForSlot({ signal, onWaiting })
    : await waitForGenerationSlot({
      isOccupied: () => jobs.isBusy(),
      signal,
      onWaiting,
    })
  return slotWaitError(result)
}

function needsConfirmResult(proposal: AgentGenerateProposal, message: string): Record<string, unknown> {
  return {
    ok: false,
    needsConfirm: true,
    proposal,
    error: message,
  }
}

function isConfirmed(host: AgentGenerateActionHost, args: Record<string, unknown>): boolean {
  return asBoolean(args.confirmed) || host.getApproveAll?.() === true
}

async function reviewPayload(
  host: AgentGenerateActionHost,
  asset: Asset,
  args: Record<string, unknown>,
  media: 'image' | 'video',
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (host.getApproveAll?.() || asBoolean(args.skipReview)) return extras
  const checkpoint = checkpointFromGenerate(args, media)
  const preview = host.readAssetPreview ? await host.readAssetPreview(asset) : null
  return {
    ...extras,
    needsReview: true,
    checkpoint,
    nextStep: nextStepForCheckpoint(checkpoint),
    ...(preview ? { preview } : {}),
  }
}

function clipById(state: EditorState, id: string) {
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  return timeline?.clips.find(clip => clip.id === id)
}

function assetById(state: EditorState, id: string): Asset | undefined {
  return state.editorModel.assets.find(asset => asset.id === id)
}

function trackLocked(state: EditorState, trackIndex: number): boolean {
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  return Boolean(timeline?.tracks[trackIndex]?.locked)
}

function parseDestination(value: unknown, fallback: AgentGenerateDestination): AgentGenerateDestination {
  if (typeof value === 'string' && (GENERATE_DESTINATIONS as readonly string[]).includes(value)) {
    return value as AgentGenerateDestination
  }
  return fallback
}

function createAssetId(): string {
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function defaultSettings(overrides: Partial<AgentGenerateSettings> = {}): AgentGenerateSettings {
  return {
    model: AGENT_DEFAULT_VIDEO_MODEL,
    duration: AGENT_DEFAULT_PREVIEW_DURATION_S,
    videoResolution: AGENT_DEFAULT_VIDEO_RESOLUTION,
    fps: 24,
    audio: false,
    cameraMotion: 'none',
    aspectRatio: AGENT_DEFAULT_ASPECT_RATIO,
    imageResolution: AGENT_DEFAULT_IMAGE_RESOLUTION,
    imageAspectRatio: AGENT_DEFAULT_ASPECT_RATIO,
    imageSteps: 4,
    ...overrides,
  }
}

function resolveGap(
  state: EditorState,
  args: Record<string, unknown>,
  getSelectedGap?: () => TimelineGapSelection | null,
): TimelineGapSelection | null {
  const trackIndex = asNumber(args.trackIndex)
  const start = asNumber(args.start)
  const end = asNumber(args.end)
  if (trackIndex != null && start != null && end != null && end > start) {
    return { trackIndex, startTime: start, endTime: end }
  }
  return getSelectedGap?.() ?? state.session.selection.gap
}

function settingsFromArgs(
  args: Record<string, unknown>,
  defaults: AgentGenerateSettings,
): AgentGenerateSettings {
  return defaultSettings({
    ...defaults,
    model: asString(args.model) ?? defaults.model,
    duration: asNumber(args.duration) ?? defaults.duration,
    videoResolution: asString(args.resolution) ?? defaults.videoResolution,
    audio: args.audio === undefined ? defaults.audio : asBoolean(args.audio),
    imageResolution: asString(args.resolution) ?? defaults.imageResolution,
    imageAspectRatio: asString(args.aspectRatio) ?? defaults.imageAspectRatio,
  })
}

function generationParamsFor(
  mode: GenerationParams['mode'],
  prompt: string,
  settings: AgentGenerateSettings,
  extras: Partial<GenerationParams> = {},
): GenerationParams {
  return {
    mode,
    prompt,
    model: settings.model,
    duration: settings.duration,
    resolution: mode === 'text-to-image' ? settings.imageResolution : settings.videoResolution,
    fps: settings.fps,
    audio: settings.audio,
    cameraMotion: settings.cameraMotion,
    imageAspectRatio: settings.imageAspectRatio,
    imageSteps: settings.imageSteps,
    ...extras,
  }
}

function buildAsset(
  copied: AgentPersistedVisualAsset,
  type: 'video' | 'image',
  prompt: string,
  settings: AgentGenerateSettings,
  params: GenerationParams,
): Asset {
  return {
    id: createAssetId(),
    type,
    path: copied.path,
    bigThumbnailPath: copied.bigThumbnailPath,
    smallThumbnailPath: copied.smallThumbnailPath,
    width: copied.width,
    height: copied.height,
    prompt,
    resolution: type === 'image' ? settings.imageResolution : settings.videoResolution,
    duration: type === 'video' ? settings.duration : undefined,
    generationParams: params,
    takes: [{
      path: copied.path,
      bigThumbnailPath: copied.bigThumbnailPath,
      smallThumbnailPath: copied.smallThumbnailPath,
      width: copied.width,
      height: copied.height,
      createdAt: Date.now(),
    }],
    activeTakeIndex: 0,
    createdAt: Date.now(),
  }
}

function placeAsset(
  host: Pick<AgentGenerateActionHost, 'getState' | 'applyWithHistory' | 'actions'>,
  asset: Asset,
  destination: AgentGenerateDestination,
  args: Record<string, unknown>,
  gap: TimelineGapSelection | null,
): Record<string, unknown> {
  const state = host.getState()
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  if (!timeline && destination !== 'assets') return errorResult('No active timeline')

  const trackIndex = asNumber(args.trackIndex) ?? gap?.trackIndex ?? 0
  if (destination !== 'assets' && trackLocked(state, trackIndex)) {
    return errorResult('Track is locked')
  }

  if (destination === 'gap') {
    if (!gap) return errorResult('No selected gap. Select a gap or pass trackIndex, start, and end.')
    if (trackLocked(state, gap.trackIndex)) return errorResult('Track is locked')
    const beforeIds = new Set(timeline?.clips.map(clip => clip.id) ?? [])
    host.applyWithHistory(prev => host.actions.insertGeneratedGapAsset(prev, {
      gap,
      asset,
      createAudio: asset.type === 'video' && Boolean(asset.generationParams?.audio),
    }))
    const next = host.getState()
    const inserted = (next.editorModel.timelines.find(item => item.id === next.editorModel.activeTimelineId)?.clips ?? [])
      .filter(clip => !beforeIds.has(clip.id))
      .map(clip => ({ id: clip.id, start: clip.startTime, duration: clip.duration, track: clip.trackIndex }))
    return {
      ok: true,
      assetId: asset.id,
      destination,
      placed: true,
      insertedClipIds: inserted.map(item => item.id),
      inserted,
    }
  }

  const startTime = destination === 'playhead'
    ? asNumber(args.startTime) ?? state.session.transport.currentTime
    : asNumber(args.startTime)

  const beforeIds = new Set(timeline?.clips.map(clip => clip.id) ?? [])
  host.applyWithHistory(prev => {
    let current = host.actions.addAssetToEditor(prev, asset)
    if (destination === 'assets') return current
    return host.actions.insertAssetsToTimeline(current, {
      assets: [asset],
      trackIndex,
      ...(startTime != null ? { startTime } : {}),
    })
  })
  const next = host.getState()
  const inserted = (next.editorModel.timelines.find(item => item.id === next.editorModel.activeTimelineId)?.clips ?? [])
    .filter(clip => !beforeIds.has(clip.id))
    .map(clip => ({ id: clip.id, start: clip.startTime, duration: clip.duration, track: clip.trackIndex }))
  return {
    ok: true,
    assetId: asset.id,
    destination,
    placed: destination !== 'assets',
    insertedClipIds: inserted.map(item => item.id),
    inserted,
  }
}

async function persistJob(
  jobs: AgentGenerationJobs,
  job: AgentGenerateJobResult,
  type: 'video' | 'image',
): Promise<{ ok: true; copied: AgentPersistedVisualAsset } | { ok: false; error: Record<string, unknown> }> {
  if (job.status === 'cancelled') return { ok: false, error: errorResult('Generation cancelled') }
  if (job.status === 'error') return { ok: false, error: errorResult(job.error) }
  const copied = await jobs.persistVisualAsset(job.path, type)
  if (!copied) return { ok: false, error: errorResult('Failed to persist generated file into the project') }
  return { ok: true, copied }
}

function settingsFromParams(params: GenerationParams): AgentGenerateSettings {
  const isImage = params.mode === 'text-to-image' || params.mode === 'image-edit'
  return defaultSettings({
    model: params.model || AGENT_DEFAULT_VIDEO_MODEL,
    duration: params.duration ?? AGENT_DEFAULT_PREVIEW_DURATION_S,
    videoResolution: isImage ? AGENT_DEFAULT_VIDEO_RESOLUTION : params.resolution || AGENT_DEFAULT_VIDEO_RESOLUTION,
    fps: params.fps || 24,
    audio: params.audio,
    cameraMotion: params.cameraMotion || 'none',
    imageResolution: isImage ? params.resolution || AGENT_DEFAULT_IMAGE_RESOLUTION : AGENT_DEFAULT_IMAGE_RESOLUTION,
    imageAspectRatio: params.imageAspectRatio || AGENT_DEFAULT_ASPECT_RATIO,
    imageSteps: params.imageSteps || 4,
  })
}

export async function executeGenerateTool(
  host: AgentGenerateActionHost,
  name: AgentGenerateToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const unknown = validateUnknownKeys(args, GENERATE_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  const jobs = host.generation
  if (!jobs) return errorResult('Generation is not available')

  if (name === 'enhance_prompt') {
    const prompt = asString(args.prompt)
    if (!prompt) return errorResult('Missing prompt')
    const waited = await waitForHostGenerationSlot(host, name)
    if (waited) return waited
    const mediaType = asString(args.mediaType) === 'image' ? 'image' : 'video'
    const enhanced = await jobs.enhancePrompt(prompt, mediaType)
    if (!enhanced.ok) return errorResult(enhanced.error)
    return { ok: true, prompt: enhanced.prompt, mediaType }
  }

  if (isConfirmed(host, args)) {
    const waited = await waitForHostGenerationSlot(host, name)
    if (waited) return waited
  }

  switch (name) {
    case 'generate_image':
      return generateStill(host, jobs, args)
    case 'generate_video':
      return generateVideo(host, jobs, args)
    case 'fill_gap':
      return fillGap(host, jobs, args)
    case 'regenerate_clip':
      return regenerateClip(host, jobs, args)
  }
}

async function generateStill(
  host: AgentGenerateActionHost,
  jobs: AgentGenerationJobs,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prompt = asString(args.prompt)
  if (!prompt) return errorResult('Missing prompt')
  const destination = parseDestination(args.destination, 'assets')
  const gap = destination === 'gap' ? resolveGap(host.getState(), args, host.getSelectedGap) : null
  const settings = settingsFromArgs(args, defaultSettings())
  const proposal: AgentGenerateProposal = {
    tool: 'generate_image',
    prompt,
    model: 'z-image',
    resolution: settings.imageResolution,
    destination,
  }
  if (!isConfirmed(host, args)) {
    return needsConfirmResult(
      proposal,
      'Generation needs confirmation. Use ask_user with prompt, resolution, and destination, then retry with confirmed=true.',
    )
  }
  if (destination === 'gap' && !gap) {
    return errorResult('No selected gap. Select a gap or pass trackIndex, start, and end.')
  }
  if (destination !== 'assets') {
    const trackIndex = asNumber(args.trackIndex) ?? gap?.trackIndex ?? 0
    if (trackLocked(host.getState(), destination === 'gap' && gap ? gap.trackIndex : trackIndex)) {
      return errorResult('Track is locked')
    }
  }
  const refStillId = asString(args.refId) ? host.refs?.resolveImageAssetId(asString(args.refId)!) : null
  const identityIds = collectIdentityStillIds({
    preferred: host.getPreferredAssemblyMedia?.(),
    refs: host.refs?.list(),
    assets: host.getState().editorModel.assets,
  })
  if (refStillId) identityIds.add(refStillId)
  const referenceAssetId = asString(args.referenceAssetId) ?? refStillId
  let referencePath: string | null = null
  let referenceStill: ReturnType<typeof assetById> | undefined
  if (referenceAssetId) {
    referenceStill = assetById(host.getState(), referenceAssetId)
    if (!referenceStill) return errorResult(`Asset not found: ${referenceAssetId}`)
    if (referenceStill.type !== 'image') return errorResult('referenceAssetId must be an image asset')
    referencePath = referenceStill.path
  }
  const animateSource = asBoolean(args.animateSource)
  const identityRef = !animateSource && (
    asBoolean(args.identityReference)
    || isIdentityStillId(referenceAssetId ?? undefined, identityIds)
    || isImportedStill(referenceStill)
  )
  // Z-Image imagePath is img2img *edit* of those pixels. An imported portrait in → the
  // same headshot out. Identity stills are new text-to-image scenes. Only pass imagePath
  // to restyle an already-generated scene still, or when the user asked to animate this photo.
  const editSourcePath = identityRef ? null : referencePath
  host.onProgress?.({ toolName: 'generate_image', percent: 0, status: 'Generating image...' })
  const job = await jobs.runImage({
    prompt,
    settings,
    ...(editSourcePath ? { imagePath: editSourcePath, strength: AGENT_DEFAULT_REF_STRENGTH } : {}),
    signal: host.getAbortSignal?.() ?? undefined,
    onProgress: progress => host.onProgress?.({ toolName: 'generate_image', ...progress }),
  })
  const persisted = await persistJob(jobs, job, 'image')
  if (!persisted.ok) return persisted.error
  const asset = buildAsset(
    persisted.copied,
    'image',
    prompt,
    settings,
    generationParamsFor('text-to-image', prompt, settings),
  )
  const placed = placeAsset(host, asset, destination, args, gap)
  if (placed.ok === false) return placed
  return reviewPayload(host, asset, args, 'image', placed)
}

async function generateVideo(
  host: AgentGenerateActionHost,
  jobs: AgentGenerationJobs,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prompt = asString(args.prompt)
  if (!prompt) return errorResult('Missing prompt')
  const state = host.getState()
  const selectedGap = resolveGap(state, args, host.getSelectedGap)
  const destination = parseDestination(args.destination, selectedGap ? 'gap' : 'playhead')
  const gap = destination === 'gap' ? selectedGap : null
  const defaultDuration = gap
    ? Math.max(AGENT_DEFAULT_PREVIEW_DURATION_S, gap.endTime - gap.startTime)
    : AGENT_DEFAULT_PREVIEW_DURATION_S
  const settings = settingsFromArgs(args, defaultSettings({ duration: defaultDuration }))
  const requestedStillId = asString(args.imageAssetId)
  const refStillId = asString(args.refId) ? host.refs?.resolveImageAssetId(asString(args.refId)!) : null
  const identityIds = collectIdentityStillIds({
    preferred: host.getPreferredAssemblyMedia?.(),
    refs: host.refs?.list(),
    assets: state.editorModel.assets,
  })
  if (refStillId) identityIds.add(refStillId)
  const animateSource = asBoolean(args.animateSource)
  const requestedStill = requestedStillId ? assetById(state, requestedStillId) : undefined
  if (requestedStillId && !requestedStill) return errorResult(`Asset not found: ${requestedStillId}`)
  if (requestedStill && requestedStill.type !== 'image') {
    return errorResult('imageAssetId must be an image asset')
  }
  const portraitStart = !animateSource && (
    isIdentityStillId(requestedStillId ?? undefined, identityIds) || isImportedStill(requestedStill)
  )
  let imageAssetId = requestedStillId && !portraitStart ? requestedStillId : null
  let imagePath: string | null = requestedStill && imageAssetId ? requestedStill.path : null
  const requestedLastId = asString(args.lastImageAssetId)
  const requestedLast = requestedLastId ? assetById(state, requestedLastId) : undefined
  if (requestedLastId && !requestedLast) return errorResult(`Asset not found: ${requestedLastId}`)
  if (requestedLast && requestedLast.type !== 'image') {
    return errorResult('lastImageAssetId must be an image asset')
  }
  const lastImageAssetId = requestedLastId && !isIdentityStillId(requestedLastId, identityIds)
    && (animateSource || !isImportedStill(requestedLast))
    ? requestedLastId
    : null
  const lastImagePath = requestedLast && lastImageAssetId ? requestedLast.path : null
  const identityId = refStillId ?? firstIdentityStillId(identityIds)
  const proposal: AgentGenerateProposal = {
    tool: 'generate_video',
    prompt,
    model: settings.model,
    duration: settings.duration,
    resolution: settings.videoResolution,
    audio: settings.audio,
    destination,
    ...(imageAssetId ? { imageAssetId } : {}),
    ...(lastImageAssetId ? { lastImageAssetId } : {}),
  }
  if (!isConfirmed(host, args)) {
    return needsConfirmResult(
      proposal,
      'Generation needs confirmation. Use ask_user with prompt, model, duration, resolution, audio, and destination, then retry with confirmed=true.',
    )
  }
  if (destination === 'gap' && !gap) {
    return errorResult('No selected gap. Select a gap or pass trackIndex, start, and end.')
  }
  if (destination !== 'assets') {
    const trackIndex = asNumber(args.trackIndex) ?? gap?.trackIndex ?? 0
    if (trackLocked(state, destination === 'gap' && gap ? gap.trackIndex : trackIndex)) {
      return errorResult('Track is locked')
    }
  }
  if (!imageAssetId && identityId) {
    const sceneStill = await generateStill(host, jobs, {
      prompt,
      destination: 'assets',
      confirmed: true,
      skipReview: true,
      referenceAssetId: identityId,
      identityReference: true,
    })
    if (sceneStill.ok === false) return sceneStill
    if (typeof sceneStill.assetId === 'string') {
      imageAssetId = sceneStill.assetId
      imagePath = assetById(host.getState(), imageAssetId)?.path ?? null
    }
  }
  host.onProgress?.({
    toolName: 'generate_video',
    percent: 0,
    status: `Generate ${settings.duration}s preview…`,
  })
  const job = await jobs.runVideo({
    prompt,
    imagePath,
    lastImagePath,
    settings,
    signal: host.getAbortSignal?.() ?? undefined,
    onProgress: progress => host.onProgress?.({ toolName: 'generate_video', ...progress }),
  })
  const persisted = await persistJob(jobs, job, 'video')
  if (!persisted.ok) return persisted.error
  const asset = buildAsset(
    persisted.copied,
    'video',
    prompt,
    settings,
    generationParamsFor(imagePath ? 'image-to-video' : 'text-to-video', prompt, settings, {
      inputImageUrl: imagePath ?? undefined,
      ...(lastImagePath ? { inputLastImageUrl: lastImagePath } : {}),
    }),
  )
  const placed = placeAsset(host, asset, destination, args, gap)
  if (placed.ok === false) return placed
  return reviewPayload(host, asset, args, 'video', placed)
}

async function fillGap(
  host: AgentGenerateActionHost,
  jobs: AgentGenerationJobs,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prompt = asString(args.prompt)
  if (!prompt) return errorResult('Missing prompt')
  const gap = resolveGap(host.getState(), args, host.getSelectedGap)
  if (!gap) return errorResult('No selected gap. Select a gap or pass trackIndex, start, and end.')
  const duration = asNumber(args.duration) ?? Math.max(AGENT_DEFAULT_PREVIEW_DURATION_S, gap.endTime - gap.startTime)
  const settings = settingsFromArgs(args, defaultSettings({ duration }))
  if (!isConfirmed(host, args)) {
    return needsConfirmResult({
      tool: 'fill_gap',
      prompt,
      model: settings.model,
      duration: settings.duration,
      resolution: settings.videoResolution,
      audio: settings.audio,
      destination: 'gap',
    }, 'Fill gap needs confirmation. Use ask_user with prompt, model, duration, and resolution, then retry with confirmed=true.')
  }
  return generateVideo(host, jobs, {
    ...args,
    duration,
    destination: 'gap',
    trackIndex: gap.trackIndex,
    start: gap.startTime,
    end: gap.endTime,
    confirmed: true,
  })
}

async function regenerateClip(
  host: AgentGenerateActionHost,
  jobs: AgentGenerationJobs,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const state = host.getState()
  const selected = [...state.session.selection.clipIds]
  const clipId = asString(args.clipId) ?? (selected.length === 1 ? selected[0] : null)
  const clip = clipId ? clipById(state, clipId) : undefined
  const assetId = asString(args.assetId) ?? clip?.assetId ?? null
  if (!assetId) return errorResult('Missing clipId or assetId')
  const asset = assetById(state, assetId)
  if (!asset) return errorResult(`Asset not found: ${assetId}`)
  const params = asset.generationParams
  if (!params) {
    return errorResult('Asset has no generationParams. Generate a new shot instead of regenerating.')
  }
  if (params.mode === 'retake' || params.mode === 'ic-lora' || params.mode === 'extend') {
    return errorResult(`${params.mode} clips cannot be regenerated from chat yet.`)
  }
  const settings = settingsFromParams(params)
  const proposal: AgentGenerateProposal = {
    tool: 'regenerate_clip',
    prompt: params.prompt,
    model: settings.model,
    duration: settings.duration,
    resolution: params.mode === 'text-to-image' || params.mode === 'image-edit'
      ? settings.imageResolution
      : settings.videoResolution,
    audio: settings.audio,
    clipId: clipId ?? undefined,
    assetId,
  }
  if (!asBoolean(args.confirmed) && host.getApproveAll?.() !== true) {
    return needsConfirmResult(
      proposal,
      'Regenerate needs confirmation. Use ask_user, then retry with confirmed=true.',
    )
  }

  const isImage = params.mode === 'text-to-image' || params.mode === 'image-edit'
  host.onProgress?.({
    toolName: 'regenerate_clip',
    percent: 0,
    status: isImage ? 'Regenerating image...' : `Regenerate ${settings.duration}s…`,
  })
  const job = isImage
    ? await jobs.runImage({
        prompt: params.prompt,
        settings,
        signal: host.getAbortSignal?.() ?? undefined,
        onProgress: progress => host.onProgress?.({ toolName: 'regenerate_clip', ...progress }),
      })
    : await jobs.runVideo({
        prompt: params.prompt,
        imagePath: params.inputImageUrl ?? null,
        settings,
        signal: host.getAbortSignal?.() ?? undefined,
        onProgress: progress => host.onProgress?.({ toolName: 'regenerate_clip', ...progress }),
      })
  const persisted = await persistJob(jobs, job, isImage ? 'image' : 'video')
  if (!persisted.ok) return persisted.error
  const take: AssetTake = {
    path: persisted.copied.path,
    bigThumbnailPath: persisted.copied.bigThumbnailPath,
    smallThumbnailPath: persisted.copied.smallThumbnailPath,
    width: persisted.copied.width,
    height: persisted.copied.height,
    createdAt: Date.now(),
  }
  host.applyWithHistory(prev => host.actions.applyGeneratedTake(prev, assetId, take, clipId ?? undefined))
  const nextAsset = assetById(host.getState(), assetId)
  return {
    ok: true,
    assetId,
    clipId: clipId ?? null,
    takeIndex: nextAsset?.activeTakeIndex ?? (nextAsset?.takes ? nextAsset.takes.length - 1 : 0),
  }
}

export function confirmQuestionsFromToolResult(result: Record<string, unknown>): AgentAskUserQuestion[] {
  const proposal = result.proposal
  const lines: string[] = []
  if (proposal && typeof proposal === 'object' && !Array.isArray(proposal)) {
    const item = proposal as Record<string, unknown>
    if (typeof item.prompt === 'string') lines.push(`Prompt: ${item.prompt}`)
    if (typeof item.model === 'string') lines.push(`Model: ${item.model}`)
    if (typeof item.duration === 'number') lines.push(`Duration: ${item.duration}s`)
    if (typeof item.resolution === 'string') lines.push(`Resolution: ${item.resolution}`)
    if (typeof item.audio === 'boolean') lines.push(`Audio: ${item.audio ? 'on' : 'off'}`)
    if (typeof item.destination === 'string') lines.push(`Place: ${item.destination}`)
    if (typeof item.count === 'number') lines.push(`Delete ${item.count} clips`)
  }
  return [{
    id: 'confirm',
    prompt: lines.length > 0 ? `Confirm:\n${lines.join('\n')}` : String(result.error ?? 'Confirm this action?'),
    kind: 'choice',
    options: ['yes', 'no'],
  }]
}
