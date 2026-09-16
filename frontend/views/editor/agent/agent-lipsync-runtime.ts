import { backendFetch } from '../../../lib/backend.ts'
import type { Asset, AssetTake } from '../../../types/project-model.ts'
import type { EditorState } from '../editor-state.ts'
import { firstUnlockedTrackIndex } from './agent-mix.ts'
import type { AgentAssemblyShot } from './agent-assembly.ts'
import { asBoolean, asString, toolErrorResult, validateUnknownKeys } from './agent-tool-utils.ts'
import { LIPSYNC_TOOL_ALLOWED_KEYS, type AgentLipSyncToolName } from './tool-definitions.ts'
import type { AgentSpeechActionHost } from './agent-speech-runtime.ts'

export interface AgentLipSyncShotResult {
  status: 'placed' | 'failed' | 'cancelled' | 'pending'
  assetId?: string
  clipId?: string
  lipSyncProvider?: string
  lipSyncAssetId?: string
  lipSyncSkipped?: string
  lipSyncError?: string
  lipSyncFallbackReason?: string
}

export type AgentLipSyncProvider = 'auto' | 'fal' | 'sync' | 'runway'

export interface AgentLipSyncJobs {
  apply: (input: {
    videoPath?: string
    audioPath?: string
    imagePath?: string
    provider?: AgentLipSyncProvider
    model?: string
  }) => Promise<
    | { path: string; provider: string; model: string; fallbackReason?: string }
    | { error: string }
  >
}

export interface AgentLipSyncActionHost extends AgentSpeechActionHost {
  actions: AgentSpeechActionHost['actions'] & {
    applyGeneratedTake: (state: EditorState, assetId: string, take: AssetTake, clipId?: string) => EditorState
    insertAssetsToTimeline: (state: EditorState, params: {
      assets: Asset[]
      trackIndex?: number
      startTime?: number
    }) => EditorState
  }
  lipsync?: AgentLipSyncJobs
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

function needsConfirmResult(proposal: Record<string, unknown>, message: string): Record<string, unknown> {
  return {
    ok: false,
    needsConfirm: true,
    proposal,
    error: message,
  }
}

function activeTimeline(state: EditorState) {
  return state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
}

function parseProvider(value: string | null): AgentLipSyncProvider {
  if (value === 'fal' || value === 'sync' || value === 'runway') return value
  return 'auto'
}

export async function applyLipSyncWithBackend(input: {
  videoPath?: string
  audioPath?: string
  imagePath?: string
  provider?: AgentLipSyncProvider
  model?: string
  fetchImpl?: typeof backendFetch
}): Promise<{ path: string; provider: string; model: string; fallbackReason?: string } | { error: string }> {
  const fetchImpl = input.fetchImpl ?? backendFetch
  try {
    const response = await fetchImpl('/api/lipsync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input.videoPath ? { videoPath: input.videoPath } : {}),
        ...(input.audioPath ? { audioPath: input.audioPath } : {}),
        ...(input.imagePath ? { imagePath: input.imagePath } : {}),
        provider: input.provider ?? 'auto',
        ...(input.model ? { model: input.model } : {}),
      }),
    })
    const payload = await response.json() as {
      path?: string
      provider?: string
      model?: string
      fallbackReason?: string
      error?: string
      detail?: string
      message?: string
    }
    if (!response.ok) {
      return { error: payload.error || payload.message || payload.detail || `Lip-sync failed (${response.status})` }
    }
    if (typeof payload.path !== 'string' || !payload.path.trim()) {
      return { error: 'Lip-sync completed without a video path' }
    }
    return {
      path: payload.path,
      provider: payload.provider ?? 'fal',
      model: payload.model ?? '',
      ...(payload.fallbackReason ? { fallbackReason: payload.fallbackReason } : {}),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Lip-sync request failed' }
  }
}

export async function resolveShotLipSyncAudio(
  host: AgentLipSyncActionHost,
  shot: Pick<AgentAssemblyShot, 'dialogue' | 'lipSync'>,
): Promise<{ path: string } | { skipped: string } | { error: string }> {
  const line = shot.dialogue?.trim()
  if (!line) return { skipped: 'Need a dialogue or sung line to lip-sync this shot.' }
  if (!host.speech) return { skipped: 'ElevenLabs speech is not available. Add an ElevenLabs API key in Settings.' }
  const synthesized = await host.speech.synthesize({ text: line })
  if ('error' in synthesized) return { error: synthesized.error }
  return { path: synthesized.path }
}

export async function applyShotLipSync<T extends AgentLipSyncShotResult>(
  host: AgentLipSyncActionHost,
  shot: AgentAssemblyShot,
  placed: T,
): Promise<T> {
  if (!shot.lipSync || placed.status !== 'placed' || !placed.assetId) return placed
  if (!host.lipsync) {
    return { ...placed, lipSyncSkipped: 'Add a Fal or Sync.so API key in Settings for dedicated lip-sync.' }
  }
  const video = host.getState().editorModel.assets.find(item => item.id === placed.assetId)
  if (!video?.path) return { ...placed, lipSyncSkipped: 'Placed video has no file path.' }

  const audio = await resolveShotLipSyncAudio(host, shot)
  if ('skipped' in audio) return { ...placed, lipSyncSkipped: audio.skipped }
  if ('error' in audio) return { ...placed, lipSyncError: audio.error }

  host.onProgress?.({ toolName: 'assemble_shots', percent: 90, status: `Lip-sync ${shot.title ?? shot.id}…` })
  const applied = await host.lipsync.apply({
    videoPath: video.path,
    audioPath: audio.path,
  })
  if ('error' in applied) return { ...placed, lipSyncError: applied.error }

  let takePath = applied.path
  if (host.importMedia) {
    const imported = await host.importMedia.importPath({
      srcPath: applied.path,
      type: 'video',
      displayName: `${shot.title ?? shot.id} lip-sync`,
    })
    if (imported) {
      host.applyWithHistory(prev => host.actions.addAssetToEditor(prev, imported))
      takePath = imported.path
      placed = { ...placed, lipSyncAssetId: imported.id }
    }
  }

  host.applyWithHistory(prev => host.actions.applyGeneratedTake(prev, placed.assetId!, {
    path: takePath,
    createdAt: Date.now(),
  }, placed.clipId))
  return {
    ...placed,
    lipSyncProvider: applied.provider,
    ...(applied.fallbackReason ? { lipSyncFallbackReason: applied.fallbackReason } : {}),
  }
}

export async function executeLipSyncTool(
  host: AgentLipSyncActionHost,
  name: AgentLipSyncToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const unknown = validateUnknownKeys(args, LIPSYNC_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  if (name !== 'apply_lipsync') return errorResult(`Unknown tool: ${name}`)

  const clipId = asString(args.clipId)
  const videoAssetId = asString(args.videoAssetId)
  const audioAssetId = asString(args.audioAssetId)
  const imageAssetId = asString(args.imageAssetId)
  const text = asString(args.text)
  const provider = parseProvider(asString(args.provider))
  const model = asString(args.model) ?? undefined
  const destination = asString(args.destination) === 'assets'
    ? 'assets'
    : asString(args.destination) === 'playhead'
      ? 'playhead'
      : 'replace'
  const proposal = {
    tool: 'apply_lipsync',
    destination,
    provider,
    ...(clipId ? { clipId } : {}),
    ...(videoAssetId ? { videoAssetId } : {}),
    ...(audioAssetId ? { audioAssetId } : {}),
    ...(imageAssetId ? { imageAssetId } : {}),
    ...(text ? { text } : {}),
    ...(model ? { model } : {}),
  }
  if (!asBoolean(args.confirmed) && host.getApproveAll?.() !== true) {
    return needsConfirmResult(proposal, 'Lip-sync needs confirmation. Retry apply_lipsync with confirmed=true.')
  }
  if (!host.lipsync) {
    return errorResult('Dedicated lip-sync is not available. Add a Fal or Sync.so API key in Settings.')
  }

  const state = host.getState()
  const clip = clipId
    ? activeTimeline(state)?.clips.find(item => item.id === clipId)
    : undefined
  const videoAsset = (videoAssetId || clip?.assetId)
    ? state.editorModel.assets.find(item => item.id === (videoAssetId || clip?.assetId))
    : undefined
  const imageAsset = imageAssetId
    ? state.editorModel.assets.find(item => item.id === imageAssetId)
    : undefined
  const audioAsset = audioAssetId
    ? state.editorModel.assets.find(item => item.id === audioAssetId)
    : undefined

  if (videoAssetId && !videoAsset) return errorResult(`Asset not found: ${videoAssetId}`)
  if (imageAssetId && !imageAsset) return errorResult(`Asset not found: ${imageAssetId}`)
  if (audioAssetId && !audioAsset) return errorResult(`Asset not found: ${audioAssetId}`)
  if (clipId && !clip) return errorResult(`Clip not found: ${clipId}`)
  if (videoAsset && videoAsset.type !== 'video' && videoAsset.type !== 'image') {
    return errorResult('videoAssetId must be a video (or a still for Fal image-to-video)')
  }
  if (audioAsset && audioAsset.type !== 'audio') return errorResult('audioAssetId must be an audio asset')

  let audioPath = audioAsset?.path
  if (!audioPath && text) {
    if (!host.speech) return errorResult('ElevenLabs speech is not available. Add an ElevenLabs API key in Settings.')
    host.onProgress?.({ toolName: 'apply_lipsync', percent: 15, status: 'Generating speech…' })
    const synthesized = await host.speech.synthesize({ text })
    if ('error' in synthesized) return errorResult(synthesized.error)
    audioPath = synthesized.path
  }
  if (!audioPath) return errorResult('Need audioAssetId or text for the sung/spoken line')

  const videoPath = videoAsset?.type === 'video' ? videoAsset.path : undefined
  const imagePath = videoAsset?.type === 'image' ? videoAsset.path : imageAsset?.path
  if (!videoPath && !imagePath) return errorResult('Need videoAssetId, clipId, or imageAssetId')

  host.onProgress?.({ toolName: 'apply_lipsync', percent: 40, status: 'Lip-syncing…' })
  const applied = await host.lipsync.apply({
    ...(videoPath ? { videoPath } : {}),
    ...(imagePath ? { imagePath } : {}),
    audioPath,
    provider,
    model,
  })
  if ('error' in applied) return errorResult(applied.error)

  if (!host.importMedia) return errorResult('Import is not available')
  const imported = await host.importMedia.importPath({
    srcPath: applied.path,
    type: 'video',
    displayName: text?.slice(0, 48) || 'Lip-sync',
  })
  if (!imported) return errorResult('Failed to import lip-synced video into the project')
  host.applyWithHistory(prev => host.actions.addAssetToEditor(prev, imported))

  const targetAssetId = videoAsset?.id
  if (destination === 'replace' && targetAssetId) {
    host.applyWithHistory(prev => host.actions.applyGeneratedTake(prev, targetAssetId, {
      path: imported.path,
      createdAt: Date.now(),
      width: imported.width,
      height: imported.height,
    }, clip?.id))
    host.onProgress?.({ toolName: 'apply_lipsync', percent: 100, status: 'Lip-sync replaced the shot' })
    return {
      ok: true,
      assetId: targetAssetId,
      lipSyncAssetId: imported.id,
      replaced: true,
      provider: applied.provider,
      model: applied.model,
      ...(applied.fallbackReason ? { fallbackReason: applied.fallbackReason } : {}),
      ...(clip?.id ? { clipId: clip.id } : {}),
    }
  }

  if (destination === 'assets') {
    return {
      ok: true,
      assetId: imported.id,
      placed: false,
      provider: applied.provider,
      model: applied.model,
      ...(applied.fallbackReason ? { fallbackReason: applied.fallbackReason } : {}),
    }
  }

  const timeline = activeTimeline(host.getState())
  const trackIndex = firstUnlockedTrackIndex(timeline?.tracks, 'video', 0)
  if (timeline?.tracks[trackIndex]?.locked) return errorResult('Track is locked')
  const startTime = host.getState().session.transport.currentTime
  host.applyWithHistory(prev => host.actions.insertAssetsToTimeline(prev, {
    assets: [imported],
    trackIndex,
    startTime,
  }))
  host.onProgress?.({ toolName: 'apply_lipsync', percent: 100, status: 'Lip-sync placed' })
  return {
    ok: true,
    assetId: imported.id,
    placed: true,
    provider: applied.provider,
    model: applied.model,
    ...(applied.fallbackReason ? { fallbackReason: applied.fallbackReason } : {}),
    start: startTime,
    duration: imported.duration ?? 0,
    trackIndex,
  }
}
