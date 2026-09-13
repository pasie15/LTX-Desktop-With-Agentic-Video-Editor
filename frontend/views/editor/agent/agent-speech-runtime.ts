import { backendFetch } from '../../../lib/backend.ts'
import type { Asset } from '../../../types/project-model.ts'
import type { EditorState } from '../editor-state.ts'
import {
  AGENT_VOICEOVER_MIX_LEVEL,
  AGENT_VOICEOVER_TRACK_INDEX,
  firstUnlockedTrackIndex,
} from './agent-mix.ts'
import { asBoolean, asNumber, asString, toolErrorResult, validateUnknownKeys } from './agent-tool-utils.ts'
import { SPEECH_TOOL_ALLOWED_KEYS, type AgentSpeechToolName } from './tool-definitions.ts'

export interface AgentSpeechJobs {
  synthesize: (input: {
    text: string
    voiceId?: string
    modelId?: string
  }) => Promise<{ path: string } | { error: string }>
}

export interface AgentSpeechActionHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  actions: {
    addAssetToEditor: (state: EditorState, asset: Asset) => EditorState
    insertAssetsToTimeline: (state: EditorState, params: {
      assets: Asset[]
      trackIndex?: number
      startTime?: number
    }) => EditorState
    setClipAudioLevel: (state: EditorState, clipId: string, volume: number) => EditorState
  }
  importMedia?: {
    importPath: (input: {
      srcPath: string
      type?: 'image' | 'video' | 'audio'
      displayName?: string
    }) => Promise<Asset | null>
  }
  speech?: AgentSpeechJobs
  getAbortSignal?: () => AbortSignal | null
  onProgress?: (progress: { toolName: string; percent: number; status: string }) => void
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

export async function synthesizeSpeechWithBackend(input: {
  text: string
  voiceId?: string
  modelId?: string
  fetchImpl?: typeof backendFetch
}): Promise<{ path: string } | { error: string }> {
  const fetchImpl = input.fetchImpl ?? backendFetch
  try {
    const response = await fetchImpl('/api/elevenlabs/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        ...(input.voiceId ? { voiceId: input.voiceId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
      }),
    })
    const payload = await response.json() as { path?: string; error?: string; detail?: string }
    if (!response.ok) {
      return { error: payload.error || payload.detail || `Speech failed (${response.status})` }
    }
    if (typeof payload.path !== 'string' || !payload.path.trim()) {
      return { error: 'Speech completed without an audio path' }
    }
    return { path: payload.path }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Speech request failed' }
  }
}

export async function importSpeechAsset(
  host: AgentSpeechActionHost,
  srcPath: string,
  displayName: string,
): Promise<{ ok: true; asset: Asset } | { ok: false; error: Record<string, unknown> }> {
  if (!host.importMedia) return { ok: false, error: errorResult('Import is not available') }
  const asset = await host.importMedia.importPath({
    srcPath,
    type: 'audio',
    displayName,
  })
  if (!asset) return { ok: false, error: errorResult('Failed to import generated speech into the project') }
  host.applyWithHistory(prev => host.actions.addAssetToEditor(prev, asset))
  return { ok: true, asset }
}

export function placeAudioAsset(
  host: AgentSpeechActionHost,
  asset: Asset,
  options: {
    trackIndex: number
    startTime: number
    volume: number
  },
): { clipId?: string; start: number; duration: number; trackIndex: number } {
  const beforeIds = new Set(activeTimeline(host.getState())?.clips.map(item => item.id) ?? [])
  host.applyWithHistory(prev => host.actions.insertAssetsToTimeline(prev, {
    assets: [asset],
    trackIndex: options.trackIndex,
    startTime: options.startTime,
  }))
  const inserted = activeTimeline(host.getState())?.clips.find(item => !beforeIds.has(item.id))
  if (inserted && options.volume !== 1) {
    host.applyWithHistory(prev => host.actions.setClipAudioLevel(prev, inserted.id, options.volume))
  } else if (inserted && options.volume === AGENT_VOICEOVER_MIX_LEVEL) {
    host.applyWithHistory(prev => host.actions.setClipAudioLevel(prev, inserted.id, AGENT_VOICEOVER_MIX_LEVEL))
  }
  return {
    clipId: inserted?.id,
    start: inserted?.startTime ?? options.startTime,
    duration: inserted?.duration ?? asset.duration ?? 0,
    trackIndex: inserted?.trackIndex ?? options.trackIndex,
  }
}

export async function executeSpeechTool(
  host: AgentSpeechActionHost,
  name: AgentSpeechToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const unknown = validateUnknownKeys(args, SPEECH_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  if (name !== 'generate_speech') return errorResult(`Unknown tool: ${name}`)

  const text = asString(args.text)
  if (!text) return errorResult('Missing text')
  const voiceId = asString(args.voiceId) ?? undefined
  const modelId = asString(args.modelId) ?? undefined
  const destination = asString(args.destination) === 'assets' ? 'assets' : 'playhead'
  const proposal = {
    tool: 'generate_speech',
    text,
    destination,
    ...(voiceId ? { voiceId } : {}),
    ...(modelId ? { modelId } : {}),
  }
  if (!asBoolean(args.confirmed)) {
    return needsConfirmResult(proposal, 'Speech needs confirmation. Retry generate_speech with confirmed=true.')
  }
  if (!host.speech) return errorResult('ElevenLabs speech is not available. Add an ElevenLabs API key in Settings.')

  host.onProgress?.({ toolName: 'generate_speech', percent: 10, status: 'Generating speech…' })
  const synthesized = await host.speech.synthesize({ text, voiceId, modelId })
  if ('error' in synthesized) return errorResult(synthesized.error)

  const imported = await importSpeechAsset(host, synthesized.path, text.slice(0, 48) || 'Voiceover')
  if (!imported.ok) return imported.error

  if (destination === 'assets') {
    return { ok: true, assetId: imported.asset.id, placed: false }
  }

  const state = host.getState()
  const timeline = activeTimeline(state)
  const trackIndex = asNumber(args.trackIndex)
    ?? firstUnlockedTrackIndex(timeline?.tracks, 'audio', AGENT_VOICEOVER_TRACK_INDEX)
  if (timeline?.tracks[trackIndex]?.locked) return errorResult('Track is locked')
  const startTime = asNumber(args.startTime) ?? state.session.transport.currentTime
  const placed = placeAudioAsset(host, imported.asset, {
    trackIndex,
    startTime,
    volume: AGENT_VOICEOVER_MIX_LEVEL,
  })
  host.onProgress?.({ toolName: 'generate_speech', percent: 100, status: 'Voiceover placed' })
  return {
    ok: true,
    assetId: imported.asset.id,
    placed: true,
    ...placed,
  }
}
