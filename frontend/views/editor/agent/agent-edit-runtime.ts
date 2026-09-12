import type { Asset, AssetTake, Timeline, TimelineClip } from '../../../types/project-model.ts'
import { createAssetBinId } from '../../../types/project-model.ts'
import type { EditorState, EditorUndoSnapshot, TimelineGapSelection } from '../editor-state.ts'
import type { AgentGenerationJobs } from './agent-generate-runtime.ts'
import { collectTimelineGaps, timelineDuration } from './agent-timeline-slice.ts'
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  toolErrorResult,
  validateUnknownKeys,
} from './agent-tool-utils.ts'
import { executeGenerateTool } from './agent-generate-runtime.ts'
import { EDIT_TOOL_ALLOWED_KEYS, isGenerateToolName, type AgentEditToolName } from './tool-definitions.ts'

export const DELETE_MANY_THRESHOLD = 2

export interface AgentEditorActions {
  insertAssetsToTimeline: (state: EditorState, params: { assets: Asset[]; trackIndex?: number; startTime?: number }) => EditorState
  overwriteAssetsOnTimeline: (state: EditorState, params: { assets: Asset[]; trackIndex?: number; startTime?: number }) => EditorState
  splitClipsAtTime: (state: EditorState, clipIds: string[], time: number) => EditorState
  moveClips: (state: EditorState, params: { clipIds: string[]; deltaTime?: number; targetTrackIndex?: number }) => EditorState
  resizeClip: (state: EditorState, params: { clipId: string; edge: 'start' | 'end'; deltaTime: number }) => EditorState
  deleteClips: (state: EditorState, clipIds: string[]) => EditorState
  addTextClip: (state: EditorState, params: { style?: { text?: string }; startTime?: number; trackIndex?: number }) => EditorState
  addSubtitle: (state: EditorState, params: { trackIndex: number; text?: string; startTime?: number; endTime?: number }) => EditorState
  addSubtitleTrack: (state: EditorState) => EditorState
  setSelectedClipIds: (state: EditorState, value: Set<string>) => EditorState
  setCurrentTime: (state: EditorState, time: number) => EditorState
  createTimeline: (state: EditorState, name?: string) => EditorState
  createBin: (state: EditorState, binId: string, name: string) => EditorState
  assignAssetsToBin: (state: EditorState, assetIds: string[], binId?: string) => EditorState
  renameBin: (state: EditorState, binId: string, newName: string) => EditorState
  addAssetToEditor: (state: EditorState, asset: Asset) => EditorState
  insertGeneratedGapAsset: (state: EditorState, params: {
    gap: TimelineGapSelection
    asset: Asset
    createAudio: boolean
  }) => EditorState
  applyGeneratedTake: (state: EditorState, assetId: string, take: AssetTake, clipId?: string) => EditorState
  undo: (state: EditorState) => EditorState
}

export interface AgentToolExecutorHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  applyWithoutHistory: (fn: (state: EditorState) => EditorState) => void
  actions: AgentEditorActions
  generation?: AgentGenerationJobs
  getSelectedGap?: () => TimelineGapSelection | null
  projectId?: string
  getAbortSignal?: () => AbortSignal | null
  onProgress?: (progress: { toolName: string; percent: number; status: string }) => void
}

interface AssistantUndoEntry {
  name: string
  after: EditorUndoSnapshot
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

function undoSnapshot(state: EditorState): EditorUndoSnapshot {
  return {
    assets: state.editorModel.assets,
    bins: state.editorModel.bins,
    timelines: state.editorModel.timelines,
  }
}

function sameUndoSnapshot(left: EditorUndoSnapshot, right: EditorUndoSnapshot): boolean {
  return left.assets === right.assets && left.bins === right.bins && left.timelines === right.timelines
}

function activeTimeline(state: EditorState): Timeline | null {
  if (state.editorModel.timelines.length === 0) return null
  return state.editorModel.timelines.find(timeline => timeline.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
}

function assetById(state: EditorState, id: string): Asset | undefined {
  return state.editorModel.assets.find(asset => asset.id === id)
}

function clipSlice(clip: TimelineClip) {
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
  const timeline = activeTimeline(state)
  if (!timeline) return { ok: true, ...extras, timeline: null }
  return {
    ok: true,
    ...extras,
    timelineId: timeline.id,
    duration: timelineDuration(timeline.clips),
    playhead: state.session.transport.currentTime,
    selectedClipIds: [...state.session.selection.clipIds],
    clips: timeline.clips.map(clipSlice),
    gaps: collectTimelineGaps(timeline.tracks, timeline.clips),
    subtitleCount: timeline.subtitles.length,
  }
}

function isEditTool(name: string): name is AgentEditToolName {
  return Object.prototype.hasOwnProperty.call(EDIT_TOOL_ALLOWED_KEYS, name)
}

function clipById(state: EditorState, id: string): TimelineClip | undefined {
  return activeTimeline(state)?.clips.find(clip => clip.id === id)
}

function trackLocked(state: EditorState, trackIndex: number): boolean {
  return Boolean(activeTimeline(state)?.tracks[trackIndex]?.locked)
}

function resolveClipIds(state: EditorState, rawIds: unknown): { ok: true; ids: string[] } | { ok: false; error: Record<string, unknown> } {
  if (rawIds != null && !Array.isArray(rawIds)) {
    return { ok: false, error: errorResult('clipIds must be an array of exact ids') }
  }
  const explicit = asStringArray(rawIds)
  const ids = explicit && explicit.length > 0 ? explicit : [...state.session.selection.clipIds]
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

function resolveAssets(state: EditorState, rawIds: unknown): { ok: true; assets: Asset[] } | { ok: false; error: Record<string, unknown> } {
  const ids = asStringArray(rawIds)
  if (!ids || ids.length === 0) return { ok: false, error: errorResult('Missing assetIds') }
  const assets: Asset[] = []
  for (const id of ids) {
    const asset = assetById(state, id)
    if (!asset) return { ok: false, error: errorResult(`Asset not found: ${id}`) }
    assets.push(asset)
  }
  return { ok: true, assets }
}

export class AgentToolExecutor {
  readonly host: AgentToolExecutorHost
  private assistantUndo: AssistantUndoEntry[] = []

  constructor(host: AgentToolExecutorHost) {
    this.host = host
  }

  resetAssistantUndo(): void {
    this.assistantUndo = []
  }

  assistantUndoNames(): readonly string[] {
    return this.assistantUndo.map(entry => entry.name)
  }

  async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (isGenerateToolName(name)) {
      const before = undoSnapshot(this.host.getState())
      const result = await executeGenerateTool(this.host, name, args)
      if (result.ok !== false) {
        const after = undoSnapshot(this.host.getState())
        if (!sameUndoSnapshot(before, after)) {
          this.assistantUndo.push({ name, after })
        }
      }
      return result
    }
    if (!isEditTool(name)) return errorResult(`Unknown tool: ${name}`)
    const unknown = validateUnknownKeys(args, EDIT_TOOL_ALLOWED_KEYS[name])
    if (unknown) return errorResult(unknown)
    if (name === 'undo') return this.undoAssistantEdit()

    const before = undoSnapshot(this.host.getState())
    const result = this.applyEdit(name, args)
    if (result.ok === false) return result
    const after = undoSnapshot(this.host.getState())
    if (!sameUndoSnapshot(before, after)) {
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
    const current = undoSnapshot(this.host.getState())
    if (!sameUndoSnapshot(current, last.after)) {
      return errorResult('Refusing to undo: the last change was not an assistant edit')
    }
    this.host.applyWithoutHistory(state => this.host.actions.undo(state))
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
    const timeline = activeTimeline(state)
    if (!timeline) return errorResult('No active timeline')
    const resolved = resolveAssets(state, args.assetIds)
    if (!resolved.ok) return resolved.error
    const trackIndex = asNumber(args.trackIndex) ?? 0
    if (trackLocked(state, trackIndex)) return errorResult('Track is locked')
    const startTime = asNumber(args.startTime)
    const beforeIds = new Set(timeline.clips.map(item => item.id))
    const params = {
      assets: resolved.assets,
      trackIndex,
      ...(startTime != null ? { startTime } : {}),
    }
    const next = this.mutate(prev => (
      mode === 'insert'
        ? this.host.actions.insertAssetsToTimeline(prev, params)
        : this.host.actions.overwriteAssetsOnTimeline(prev, params)
    ))
    const inserted = (activeTimeline(next)?.clips ?? []).filter(item => !beforeIds.has(item.id)).map(clipSlice)
    if (inserted.length === 0) {
      return errorResult('Insert produced no clips. Check track kind, lock, and asset ids.')
    }
    return timelineSlice(next, { insertedClipIds: inserted.map(item => item.id), inserted })
  }

  private splitClips(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const resolved = resolveClipIds(state, args.clipIds)
    if (!resolved.ok) return resolved.error
    const locked = refuseIfLocked(state, resolved.ids)
    if (locked) return locked
    const time = asNumber(args.time) ?? state.session.transport.currentTime
    const beforeIds = new Set(activeTimeline(state)?.clips.map(item => item.id) ?? [])
    const next = this.mutate(prev => this.host.actions.splitClipsAtTime(prev, resolved.ids, time))
    const created = (activeTimeline(next)?.clips ?? []).filter(item => !beforeIds.has(item.id)).map(clipSlice)
    if (created.length === 0) {
      return errorResult('Split produced no new clips. Time must be inside the clip, away from both edges.')
    }
    return timelineSlice(next, { createdClipIds: created.map(item => item.id), created })
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
        const found = clipById(state, id)
        return found ? Math.min(min, found.startTime) : min
      }, Number.POSITIVE_INFINITY)
      if (!Number.isFinite(earliest)) return errorResult('Clip not found')
      deltaTime = absoluteStart - earliest
    }
    if (deltaTime === 0 && targetTrackIndex == null) {
      return errorResult('Provide deltaTime, start, or trackIndex')
    }
    const next = this.mutate(prev => this.host.actions.moveClips(prev, {
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
    const selected = [...state.session.selection.clipIds]
    const id = asString(args.id) ?? (selected.length === 1 ? selected[0] : null)
    if (!id) return errorResult('Missing id')
    const clip = clipById(state, id)
    if (!clip) return errorResult('Clip not found')
    if (trackLocked(state, clip.trackIndex)) return errorResult('Track is locked')
    const start = asNumber(args.start)
    const end = asNumber(args.end)
    let duration = asNumber(args.duration)
    if (duration == null && end != null) {
      duration = end - (start ?? clip.startTime)
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
        current = this.host.actions.resizeClip(current, {
          clipId: id,
          edge: 'start',
          deltaTime: start - live.startTime,
        })
      }
      const afterStart = clipById(current, id)
      if (afterStart && duration != null && duration !== afterStart.duration) {
        current = this.host.actions.resizeClip(current, {
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
    const next = this.mutate(prev => this.host.actions.deleteClips(prev, resolved.ids))
    return timelineSlice(next, { deletedClipIds: resolved.ids })
  }

  private addText(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const timeline = activeTimeline(state)
    if (!timeline) return errorResult('No active timeline')
    const text = asString(args.text)
    if (!text) return errorResult('Missing text')
    const trackIndex = asNumber(args.trackIndex)
    const startTime = asNumber(args.startTime)
    const duration = asNumber(args.duration)
    if (trackIndex != null && trackLocked(state, trackIndex)) return errorResult('Track is locked')
    const beforeIds = new Set(timeline.clips.map(item => item.id))
    const next = this.mutate(prev => {
      let current = this.host.actions.addTextClip(prev, {
        style: { text },
        ...(startTime != null ? { startTime } : {}),
        ...(trackIndex != null ? { trackIndex } : {}),
      })
      const created = activeTimeline(current)?.clips.find(item => !beforeIds.has(item.id))
      if (created && duration != null && duration !== created.duration) {
        current = this.host.actions.resizeClip(current, {
          clipId: created.id,
          edge: 'end',
          deltaTime: duration - created.duration,
        })
      }
      return current
    })
    const created = (activeTimeline(next)?.clips ?? []).find(item => !beforeIds.has(item.id))
    if (!created) return errorResult('Failed to add text clip')
    return timelineSlice(next, { clip: clipSlice(created) })
  }

  private addSubtitle(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const timeline = activeTimeline(state)
    if (!timeline) return errorResult('No active timeline')
    const text = asString(args.text)
    if (!text) return errorResult('Missing text')
    const startTime = asNumber(args.startTime)
    const endTime = asNumber(args.endTime)
    const requestedTrack = asNumber(args.trackIndex)
    const beforeIds = new Set(timeline.subtitles.map(subtitle => subtitle.id))
    const next = this.mutate(prev => {
      let current = prev
      let trackIndex = requestedTrack
      if (trackIndex == null) {
        const existing = activeTimeline(current)?.tracks.findIndex(track => track.type === 'subtitle') ?? -1
        if (existing < 0) {
          current = this.host.actions.addSubtitleTrack(current)
          trackIndex = 0
        } else {
          trackIndex = existing
        }
      }
      if (trackLocked(current, trackIndex)) return prev
      return this.host.actions.addSubtitle(current, {
        text,
        trackIndex,
        ...(startTime != null ? { startTime } : {}),
        ...(endTime != null ? { endTime } : {}),
      })
    })
    const created = (activeTimeline(next)?.subtitles ?? []).find(subtitle => !beforeIds.has(subtitle.id))
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
    const next = this.mutate(prev => this.host.actions.setSelectedClipIds(prev, new Set(ids)))
    const selected = [...next.session.selection.clipIds]
    return {
      ok: true,
      selectedClipIds: selected,
      selectedClips: selected.flatMap(id => {
        const found = clipById(next, id)
        return found ? [clipSlice(found)] : []
      }),
    }
  }

  private setPlayhead(args: Record<string, unknown>): Record<string, unknown> {
    const time = asNumber(args.time)
    if (time == null || time < 0) return errorResult('time must be a non-negative number of seconds')
    const next = this.mutate(prev => this.host.actions.setCurrentTime(prev, time))
    return { ok: true, playhead: next.session.transport.currentTime }
  }

  private createTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const name = asString(args.name)
    const beforeIds = new Set(this.host.getState().editorModel.timelines.map(timeline => timeline.id))
    const next = this.mutate(prev => this.host.actions.createTimeline(prev, name ?? undefined))
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
    const next = this.mutate(prev => this.host.actions.createBin(prev, binId, name))
    if (!next.editorModel.bins[binId]) return errorResult('Failed to create bin')
    return { ok: true, binId, name: next.editorModel.bins[binId] }
  }

  private assignAssetsToBin(args: Record<string, unknown>): Record<string, unknown> {
    const assetIds = asStringArray(args.assetIds)
    if (!assetIds || assetIds.length === 0) return errorResult('Missing assetIds')
    const state = this.host.getState()
    const missing = assetIds.filter(id => !assetById(state, id))
    if (missing.length > 0) return errorResult(`Asset not found: ${missing.join(', ')}`)
    const binId = asString(args.binId)
    if (args.binId != null && !binId) return errorResult('binId must be a non-empty string')
    if (binId && !state.editorModel.bins[binId]) return errorResult('Bin not found')
    const next = this.mutate(prev => this.host.actions.assignAssetsToBin(prev, assetIds, binId ?? undefined))
    return {
      ok: true,
      assetIds,
      binId: binId ?? null,
      assigned: assetIds.map(id => ({
        id,
        binId: assetById(next, id)?.binId ?? null,
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
    const next = this.mutate(prev => this.host.actions.renameBin(prev, binId, name))
    return { ok: true, binId, name: next.editorModel.bins[binId] }
  }
}
