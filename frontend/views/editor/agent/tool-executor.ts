import { backendFetch } from '../../../lib/backend'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectAssetBins,
  selectAssetById,
  selectAssets,
  selectSelectedClipIds,
  selectSelectedClips,
  selectSelectedGap,
} from '../editor-selectors'
import { collectTimelineGaps, timelineDuration } from './agent-timeline-slice'
import { listGenerationModels, toolErrorResult, validateUnknownKeys } from './agent-tool-utils'
import { READ_TOOL_ALLOWED_KEYS, type AgentReadToolName } from './tool-definitions'

export { listGenerationModels, validateUnknownKeys } from './agent-tool-utils'

export interface ExecuteReadToolInput {
  name: string
  args: Record<string, unknown>
  state: EditorState
  fetchImpl?: typeof backendFetch
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

function clipSlice(clip: ReturnType<typeof selectSelectedClips>[number]) {
  return {
    id: clip.id,
    assetId: clip.assetId,
    type: clip.type,
    track: clip.trackIndex,
    start: clip.startTime,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    speed: clip.speed,
    volume: clip.volume,
    opacity: clip.opacity,
  }
}

export async function executeReadTool(input: ExecuteReadToolInput): Promise<Record<string, unknown>> {
  const name = input.name as AgentReadToolName
  const allowed = READ_TOOL_ALLOWED_KEYS[name]
  if (!allowed) return errorResult(`Unknown tool: ${input.name}`)
  const unknown = validateUnknownKeys(input.args, allowed)
  if (unknown) return errorResult(unknown)

  switch (name) {
    case 'get_project_overview':
      return readProjectOverview(input.state)
    case 'get_timeline':
      return readTimeline(input.state, asNumber(input.args.start), asNumber(input.args.end))
    case 'get_assets':
      return readAssets(input.state, asString(input.args.query), asString(input.args.type), asString(input.args.binId))
    case 'get_selection':
      return readSelection(input.state)
    case 'get_clip':
      return readClip(input.state, asString(input.args.id))
    case 'get_asset':
      return readAsset(input.state, asString(input.args.id))
    case 'list_generation_models':
      return listGenerationModels(input.fetchImpl ?? backendFetch)
    case 'ask_user':
      return errorResult('ask_user is handled by the chat loop, not the executor')
  }
}

function readProjectOverview(state: EditorState): Record<string, unknown> {
  const assets = selectAssets(state)
  const counts = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.type] = (acc[asset.type] ?? 0) + 1
    return acc
  }, {})
  return {
    ok: true,
    assetCount: assets.length,
    assetCounts: counts,
    binCount: Object.keys(state.editorModel.bins).length,
    timelines: state.editorModel.timelines.map(timeline => ({
      id: timeline.id,
      name: timeline.name,
      clipCount: timeline.clips.length,
      duration: timelineDuration(timeline.clips),
      active: timeline.id === state.editorModel.activeTimelineId,
    })),
  }
}

function readTimeline(state: EditorState, start: number | null, end: number | null): Record<string, unknown> {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return errorResult('No active timeline')
  let clips = timeline.clips
  if (start != null || end != null) {
    const windowStart = start ?? Number.NEGATIVE_INFINITY
    const windowEnd = end ?? Number.POSITIVE_INFINITY
    clips = clips.filter(clip => {
      const clipEnd = clip.startTime + clip.duration
      return clipEnd >= windowStart && clip.startTime <= windowEnd
    })
  }
  return {
    ok: true,
    id: timeline.id,
    name: timeline.name,
    duration: timelineDuration(timeline.clips),
    tracks: timeline.tracks.map((track, index) => ({
      index,
      id: track.id,
      name: track.name,
      kind: track.kind,
      type: track.type,
      locked: track.locked,
      muted: track.muted,
    })),
    clips: clips.map(clipSlice),
    subtitleCount: timeline.subtitles.length,
    gaps: collectTimelineGaps(timeline.tracks, timeline.clips),
  }
}

function readAssets(
  state: EditorState,
  query: string | null,
  type: string | null,
  binId: string | null,
): Record<string, unknown> {
  const lowered = query?.toLowerCase() ?? ''
  const assets = selectAssets(state).filter(asset => {
    if (type && asset.type !== type) return false
    if (binId && asset.binId !== binId) return false
    if (!lowered) return true
    return asset.id.toLowerCase().includes(lowered) || asset.prompt.toLowerCase().includes(lowered)
  })
  return {
    ok: true,
    bins: selectAssetBins(state),
    assets: assets.map(asset => ({
      id: asset.id,
      type: asset.type,
      name: asset.prompt || asset.id,
      duration: asset.duration,
      resolution: asset.resolution,
      binId: asset.binId,
      favorite: asset.favorite ?? false,
      prompt: asset.generationParams?.prompt || asset.prompt,
    })),
  }
}

function readSelection(state: EditorState): Record<string, unknown> {
  const gap = selectSelectedGap(state)
  return {
    ok: true,
    playhead: state.session.transport.currentTime,
    inPoint: selectActiveTimelineInPoint(state),
    outPoint: selectActiveTimelineOutPoint(state),
    selectedClipIds: [...selectSelectedClipIds(state)],
    selectedClips: selectSelectedClips(state).map(clipSlice),
    selectedGap: gap
      ? { trackIndex: gap.trackIndex, start: gap.startTime, end: gap.endTime }
      : null,
  }
}

function readClip(state: EditorState, id: string | null): Record<string, unknown> {
  if (!id) return errorResult('Missing id')
  const timeline = selectActiveTimeline(state)
  const clip = timeline?.clips.find(item => item.id === id)
  if (!clip) return errorResult('Clip not found')
  return { ok: true, clip: clipSlice(clip) }
}

function readAsset(state: EditorState, id: string | null): Record<string, unknown> {
  if (!id) return errorResult('Missing id')
  const asset = selectAssetById(state, id)
  if (!asset) return errorResult('Asset not found')
  return {
    ok: true,
    asset: {
      id: asset.id,
      type: asset.type,
      path: asset.path,
      prompt: asset.prompt,
      duration: asset.duration,
      resolution: asset.resolution,
      width: asset.width,
      height: asset.height,
      binId: asset.binId,
      favorite: asset.favorite ?? false,
      generationParams: asset.generationParams,
    },
  }
}

