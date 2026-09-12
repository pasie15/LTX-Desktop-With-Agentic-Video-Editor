import { backendFetch } from '../../../lib/backend'
import { createAssetBinId } from '../../../types/project-model'
import * as editorActions from '../editor-actions'
import type { EditorState, EditorUndoSnapshot } from '../editor-state'
import { equalUndoSnapshot, getUndoSnapshot } from '../editor-state'
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
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  listGenerationModels,
  toolErrorResult,
  validateUnknownKeys,
} from './agent-tool-utils'
import {
  AGENT_TOOL_ALLOWED_KEYS,
  EDIT_TOOL_ALLOWED_KEYS,
  READ_TOOL_ALLOWED_KEYS,
  type AgentEditToolName,
  type AgentReadToolName,
  type AgentToolName,
} from './tool-definitions'

export { listGenerationModels, validateUnknownKeys } from './agent-tool-utils'

export const DELETE_MANY_THRESHOLD = 2

export interface ExecuteReadToolInput {
  name: string
  args: Record<string, unknown>
  state: EditorState
  fetchImpl?: typeof backendFetch
}

export interface AgentToolExecutorHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  applyWithoutHistory: (fn: (state: EditorState) => EditorState) => void
  fetchImpl?: typeof backendFetch
}

interface AssistantUndoEntry {
  name: string
  after: EditorUndoSnapshot
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

function timelineSlice(state: EditorState, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const timeline = selectActiveTimeline(state)
  if (!timeline) {
    return { ok: true, ...extras, timeline: null }
  }
  return {
    ok: true,
    ...extras,
    timelineId: timeline.id,
    duration: timelineDuration(timeline.clips),
    playhead: state.session.transport.currentTime,
    selectedClipIds: [...selectSelectedClipIds(state)],
    clips: timeline.clips.map(clipSlice),
    gaps: collectTimelineGaps(timeline.tracks, timeline.clips),
    subtitleCount: timeline.subtitles.length,
  }
}

function isReadTool(name: string): name is AgentReadToolName {
  return Object.prototype.hasOwnProperty.call(READ_TOOL_ALLOWED_KEYS, name)
}

function isEditTool(name: string): name is AgentEditToolName {
  return Object.prototype.hasOwnProperty.call(EDIT_TOOL_ALLOWED_KEYS, name)
}

function requireActiveTimeline(state: EditorState) {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return { ok: false as const, error: errorResult('No active timeline') }
  return { ok: true as const, timeline }
}

function clipById(state: EditorState, id: string) {
  return selectActiveTimeline(state)?.clips.find(clip => clip.id === id)
}

function trackLocked(state: EditorState, trackIndex: number): boolean {
  return Boolean(selectActiveTimeline(state)?.tracks[trackIndex]?.locked)
}

function resolveClipIds(state: EditorState, rawIds: unknown): { ok: true; ids: string[] } | { ok: false; error: Record<string, unknown> } {
  if (rawIds != null && !Array.isArray(rawIds)) {
    return { ok: false, error: errorResult('clipIds must be an array of exact ids') }
  }
  const explicit = asStringArray(rawIds)
  const ids = explicit && explicit.length > 0 ? explicit : [...selectSelectedClipIds(state)]
  if (ids.length === 0) {
    return { ok: false, error: errorResult('Missing clipIds and there is no selection') }
  }
  const missing = ids.filter(id => !clipById(state, id))
  if (missing.length > 0) {
    return { ok: false, error: errorResult(`Clip not found: ${missing.join(', ')}`) }
  }
  return { ok: true, ids }
}

function refuseIfLocked(state: EditorState, clipIds: string[], targetTrackIndex?: number | null): Record<string, unknown> | null {
  if (targetTrackIndex != null && trackLocked(state, targetTrackIndex)) {
    return errorResult('Track is locked')
  }
  const locked = clipIds.filter(id => {
    const clip = clipById(state, id)
    return clip != null && trackLocked(state, clip.trackIndex)
  })
  if (locked.length > 0) return errorResult('Track is locked')
  return null
}

function resolveAssets(state: EditorState, rawIds: unknown): { ok: true; assets: NonNullable<ReturnType<typeof selectAssetById>>[] } | { ok: false; error: Record<string, unknown> } {
  const ids = asStringArray(rawIds)
  if (!ids || ids.length === 0) return { ok: false, error: errorResult('Missing assetIds') }
  const assets = []
  for (const id of ids) {
    const asset = selectAssetById(state, id)
    if (!asset) return { ok: false, error: errorResult(`Asset not found: ${id}`) }
    assets.push(asset)
  }
  return { ok: true, assets }
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

export class AgentToolExecutor {
  private assistantUndo: AssistantUndoEntry[] = []

  constructor(private readonly host: AgentToolExecutorHost) {}

  resetAssistantUndo(): void {
    this.assistantUndo = []
  }

  assistantUndoNames(): readonly string[] {
    return this.assistantUndo.map(entry => entry.name)
  }

  async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const allowed = AGENT_TOOL_ALLOWED_KEYS[name as AgentToolName]
    if (!allowed) return errorResult(`Unknown tool: ${name}`)
    const unknown = validateUnknownKeys(args, allowed)
    if (unknown) return errorResult(unknown)

    if (isReadTool(name)) {
      return executeReadTool({
        name,
        args,
        state: this.host.getState(),
        fetchImpl: this.host.fetchImpl,
      })
    }
    if (!isEditTool(name)) return errorResult(`Unknown tool: ${name}`)
    return this.executeEdit(name, args)
  }

  private executeEdit(name: AgentEditToolName, args: Record<string, unknown>): Record<string, unknown> {
    if (name === 'undo') return this.undoAssistantEdit()

    const before = getUndoSnapshot(this.host.getState())
    const result = this.applyEdit(name, args)
    if (result.ok === false) return result

    const afterState = this.host.getState()
    const after = getUndoSnapshot(afterState)
    if (!equalUndoSnapshot(before, after)) {
      this.assistantUndo.push({ name, after })
    }
    return result
  }

  private mutate(fn: (state: EditorState) => EditorState): EditorState {
    this.host.applyWithHistory(fn)
    return this.host.getState()
  }

  private undoAssistantEdit(): Record<string, unknown> {
    const last = this.assistantUndo[this.assistantUndo.length - 1]
    if (!last) return errorResult('Nothing to undo from the assistant')
    const current = getUndoSnapshot(this.host.getState())
    if (!equalUndoSnapshot(current, last.after)) {
      return errorResult('Refusing to undo: the last change was not an assistant edit')
    }
    this.host.applyWithoutHistory(state => editorActions.undo(state))
    this.assistantUndo.pop()
    return timelineSlice(this.host.getState(), { undone: last.name })
  }

  private applyEdit(name: AgentEditToolName, args: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case 'insert_assets':
        return this.insertOrOverwrite(args, 'insert')
      case 'overwrite_assets':
        return this.insertOrOverwrite(args, 'overwrite')
      case 'split_clips':
        return this.splitClips(args)
      case 'move_clips':
        return this.moveClips(args)
      case 'trim_clip':
        return this.trimClip(args)
      case 'delete_clips':
        return this.deleteClips(args)
      case 'add_text':
        return this.addText(args)
      case 'add_subtitle':
        return this.addSubtitle(args)
      case 'select_clips':
        return this.selectClips(args)
      case 'set_playhead':
        return this.setPlayhead(args)
      case 'create_timeline':
        return this.createTimeline(args)
      case 'create_bin':
        return this.createBin(args)
      case 'assign_assets_to_bin':
        return this.assignAssetsToBin(args)
      case 'rename_bin':
        return this.renameBin(args)
      case 'undo':
        return this.undoAssistantEdit()
    }
  }

  private insertOrOverwrite(args: Record<string, unknown>, mode: 'insert' | 'overwrite'): Record<string, unknown> {
    const state = this.host.getState()
    const timelineCheck = requireActiveTimeline(state)
    if (!timelineCheck.ok) return timelineCheck.error
    const resolved = resolveAssets(state, args.assetIds)
    if (!resolved.ok) return resolved.error
    const trackIndex = asNumber(args.trackIndex) ?? 0
    if (trackLocked(state, trackIndex)) return errorResult('Track is locked')
    const startTime = asNumber(args.startTime)
    const beforeIds = new Set(timelineCheck.timeline.clips.map(clip => clip.id))
    const params = {
      assets: resolved.assets,
      trackIndex,
      ...(startTime != null ? { startTime } : {}),
    }
    const next = this.mutate(prev => (
      mode === 'insert'
        ? editorActions.insertAssetsToTimeline(prev, params)
        : editorActions.overwriteAssetsOnTimeline(prev, params)
    ))
    const nextTimeline = selectActiveTimeline(next)
    const inserted = (nextTimeline?.clips ?? []).filter(clip => !beforeIds.has(clip.id)).map(clipSlice)
    if (inserted.length === 0) {
      return errorResult('Insert produced no clips. Check track kind, lock, and asset ids.')
    }
    return timelineSlice(next, { insertedClipIds: inserted.map(clip => clip.id), inserted })
  }

  private splitClips(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const resolved = resolveClipIds(state, args.clipIds)
    if (!resolved.ok) return resolved.error
    const locked = refuseIfLocked(state, resolved.ids)
    if (locked) return locked
    const time = asNumber(args.time) ?? state.session.transport.currentTime
    const beforeIds = new Set(selectActiveTimeline(state)?.clips.map(clip => clip.id) ?? [])
    const next = this.mutate(prev => editorActions.splitClipsAtTime(prev, resolved.ids, time))
    const created = (selectActiveTimeline(next)?.clips ?? []).filter(clip => !beforeIds.has(clip.id)).map(clipSlice)
    if (created.length === 0) {
      return errorResult('Split produced no new clips. Time must be inside the clip, away from both edges.')
    }
    return timelineSlice(next, { createdClipIds: created.map(clip => clip.id), created })
  }

  private moveClips(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const resolved = resolveClipIds(state, args.clipIds)
    if (!resolved.ok) return resolved.error
    const targetTrackIndex = asNumber(args.trackIndex)
    const locked = refuseIfLocked(state, resolved.ids, targetTrackIndex)
    if (locked) return locked
    const absoluteStart = asNumber(args.start)
    let deltaTime = asNumber(args.deltaTime) ?? 0
    if (absoluteStart != null) {
      const earliest = resolved.ids.reduce((min, id) => {
        const clip = clipById(state, id)
        return clip ? Math.min(min, clip.startTime) : min
      }, Number.POSITIVE_INFINITY)
      if (!Number.isFinite(earliest)) return errorResult('Clip not found')
      deltaTime = absoluteStart - earliest
    }
    if (deltaTime === 0 && targetTrackIndex == null) {
      return errorResult('Provide deltaTime, start, or trackIndex')
    }
    const next = this.mutate(prev => editorActions.moveClips(prev, {
      clipIds: resolved.ids,
      deltaTime,
      ...(targetTrackIndex != null ? { targetTrackIndex } : {}),
    }))
    const moved = resolved.ids.flatMap(id => {
      const found = clipById(next, id)
      return found ? [clipSlice(found)] : []
    })
    return timelineSlice(next, { movedClipIds: resolved.ids, moved })
  }

  private trimClip(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const id = asString(args.id) ?? (selectSelectedClipIds(state).size === 1 ? [...selectSelectedClipIds(state)][0] : null)
    if (!id) return errorResult('Missing id')
    const clip = clipById(state, id)
    if (!clip) return errorResult('Clip not found')
    if (trackLocked(state, clip.trackIndex)) return errorResult('Track is locked')
    const start = asNumber(args.start)
    const end = asNumber(args.end)
    let duration = asNumber(args.duration)
    if (duration == null && end != null) {
      const origin = start ?? clip.startTime
      duration = end - origin
    }
    if (start == null && duration == null) {
      return errorResult('Provide start, duration, or end')
    }
    if (duration != null && duration < 0.1) return errorResult('duration must be at least 0.1s')
    const next = this.mutate(prev => {
      let current = prev
      const live = clipById(current, id)
      if (!live) return prev
      if (start != null && start !== live.startTime) {
        current = editorActions.resizeClip(current, {
          clipId: id,
          edge: 'start',
          deltaTime: start - live.startTime,
        })
      }
      const afterStart = clipById(current, id)
      if (afterStart && duration != null && duration !== afterStart.duration) {
        current = editorActions.resizeClip(current, {
          clipId: id,
          edge: 'end',
          deltaTime: duration - afterStart.duration,
        })
      }
      return current
    })
    const updated = clipById(next, id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
  }

  private deleteClips(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const resolved = resolveClipIds(state, args.clipIds)
    if (!resolved.ok) return resolved.error
    const locked = refuseIfLocked(state, resolved.ids)
    if (locked) return locked
    if (resolved.ids.length >= DELETE_MANY_THRESHOLD && !asBoolean(args.confirmed)) {
      return {
        ok: false,
        needsConfirm: true,
        count: resolved.ids.length,
        clipIds: resolved.ids,
        error: `Deleting ${resolved.ids.length} clips needs confirmation. Use ask_user, then call delete_clips with confirmed=true.`,
      }
    }
    const next = this.mutate(prev => editorActions.deleteClips(prev, resolved.ids))
    return timelineSlice(next, { deletedClipIds: resolved.ids })
  }

  private addText(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const timelineCheck = requireActiveTimeline(state)
    if (!timelineCheck.ok) return timelineCheck.error
    const text = asString(args.text)
    if (!text) return errorResult('Missing text')
    const trackIndex = asNumber(args.trackIndex)
    const startTime = asNumber(args.startTime)
    const duration = asNumber(args.duration)
    if (trackIndex != null && trackLocked(state, trackIndex)) return errorResult('Track is locked')
    const beforeIds = new Set(timelineCheck.timeline.clips.map(clip => clip.id))
    const next = this.mutate(prev => {
      let current = editorActions.addTextClip(prev, {
        style: { text },
        ...(startTime != null ? { startTime } : {}),
        ...(trackIndex != null ? { trackIndex } : {}),
      })
      const created = selectActiveTimeline(current)?.clips.find(clip => !beforeIds.has(clip.id))
      if (created && duration != null && duration !== created.duration) {
        current = editorActions.resizeClip(current, {
          clipId: created.id,
          edge: 'end',
          deltaTime: duration - created.duration,
        })
      }
      return current
    })
    const created = (selectActiveTimeline(next)?.clips ?? []).find(clip => !beforeIds.has(clip.id))
    if (!created) return errorResult('Failed to add text clip')
    return timelineSlice(next, { clip: clipSlice(created) })
  }

  private addSubtitle(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const timelineCheck = requireActiveTimeline(state)
    if (!timelineCheck.ok) return timelineCheck.error
    const text = asString(args.text)
    if (!text) return errorResult('Missing text')
    const startTime = asNumber(args.startTime)
    const endTime = asNumber(args.endTime)
    const requestedTrack = asNumber(args.trackIndex)
    const beforeIds = new Set(timelineCheck.timeline.subtitles.map(subtitle => subtitle.id))
    const next = this.mutate(prev => {
      let current = prev
      let trackIndex = requestedTrack
      if (trackIndex == null) {
        const existing = selectActiveTimeline(current)?.tracks.findIndex(track => track.type === 'subtitle') ?? -1
        if (existing < 0) {
          current = editorActions.addSubtitleTrack(current)
          trackIndex = 0
        } else {
          trackIndex = existing
        }
      }
      if (trackLocked(current, trackIndex)) return prev
      return editorActions.addSubtitle(current, {
        text,
        trackIndex,
        ...(startTime != null ? { startTime } : {}),
        ...(endTime != null ? { endTime } : {}),
      })
    })
    const created = (selectActiveTimeline(next)?.subtitles ?? []).find(subtitle => !beforeIds.has(subtitle.id))
    if (!created) return errorResult('Failed to add subtitle. Track may be locked.')
    return timelineSlice(next, {
      subtitle: {
        id: created.id,
        text: created.text,
        start: created.startTime,
        end: created.endTime,
        track: created.trackIndex,
      },
    })
  }

  private selectClips(args: Record<string, unknown>): Record<string, unknown> {
    if (args.clipIds != null && !Array.isArray(args.clipIds)) {
      return errorResult('clipIds must be an array of exact ids')
    }
    const ids = asStringArray(args.clipIds) ?? []
    const state = this.host.getState()
    if (ids.length > 0) {
      const missing = ids.filter(id => !clipById(state, id))
      if (missing.length > 0) return errorResult(`Clip not found: ${missing.join(', ')}`)
    }
    const next = this.mutate(prev => editorActions.setSelectedClipIds(prev, new Set(ids)))
    return {
      ok: true,
      selectedClipIds: [...selectSelectedClipIds(next)],
      selectedClips: selectSelectedClips(next).map(clipSlice),
    }
  }

  private setPlayhead(args: Record<string, unknown>): Record<string, unknown> {
    const time = asNumber(args.time)
    if (time == null || time < 0) return errorResult('time must be a non-negative number of seconds')
    const next = this.mutate(prev => editorActions.setCurrentTime(prev, time))
    return { ok: true, playhead: next.session.transport.currentTime }
  }

  private createTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const name = asString(args.name)
    const beforeIds = new Set(this.host.getState().editorModel.timelines.map(timeline => timeline.id))
    const next = this.mutate(prev => editorActions.createTimeline(prev, name ?? undefined))
    const created = next.editorModel.timelines.find(timeline => !beforeIds.has(timeline.id))
    if (!created) return errorResult('Failed to create timeline')
    return {
      ok: true,
      timeline: {
        id: created.id,
        name: created.name,
        clipCount: created.clips.length,
        duration: 0,
        active: created.id === next.editorModel.activeTimelineId,
      },
    }
  }

  private createBin(args: Record<string, unknown>): Record<string, unknown> {
    const name = asString(args.name)
    if (!name) return errorResult('Missing name')
    const bins = this.host.getState().editorModel.bins
    if (Object.values(bins).includes(name)) {
      return errorResult('A bin with that name already exists')
    }
    const binId = createAssetBinId()
    const next = this.mutate(prev => editorActions.createBin(prev, binId, name))
    if (!next.editorModel.bins[binId]) return errorResult('Failed to create bin')
    return { ok: true, binId, name: next.editorModel.bins[binId] }
  }

  private assignAssetsToBin(args: Record<string, unknown>): Record<string, unknown> {
    const assetIds = asStringArray(args.assetIds)
    if (!assetIds || assetIds.length === 0) return errorResult('Missing assetIds')
    const state = this.host.getState()
    const missing = assetIds.filter(id => !selectAssetById(state, id))
    if (missing.length > 0) return errorResult(`Asset not found: ${missing.join(', ')}`)
    const binId = asString(args.binId)
    if (args.binId != null && !binId) return errorResult('binId must be a non-empty string')
    if (binId && !state.editorModel.bins[binId]) return errorResult('Bin not found')
    const next = this.mutate(prev => editorActions.assignAssetsToBin(prev, assetIds, binId ?? undefined))
    return {
      ok: true,
      assetIds,
      binId: binId ?? null,
      assigned: assetIds.map(id => ({
        id,
        binId: selectAssetById(next, id)?.binId ?? null,
      })),
    }
  }

  private renameBin(args: Record<string, unknown>): Record<string, unknown> {
    const binId = asString(args.binId)
    const name = asString(args.name)
    if (!binId) return errorResult('Missing binId')
    if (!name) return errorResult('Missing name')
    const state = this.host.getState()
    if (!state.editorModel.bins[binId]) return errorResult('Bin not found')
    if (Object.entries(state.editorModel.bins).some(([id, existing]) => id !== binId && existing === name)) {
      return errorResult('A bin with that name already exists')
    }
    const next = this.mutate(prev => editorActions.renameBin(prev, binId, name))
    return { ok: true, binId, name: next.editorModel.bins[binId] }
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
