import type { Asset, AssetTake, SubtitleClip, TextOverlayStyle, Timeline, TimelineClip } from '../../../types/project-model.ts'
import { createAssetBinId } from '../../../types/project-model.ts'
import type { EditorState, EditorUndoSnapshot, TimelineGapSelection } from '../editor-state.ts'
import type { AgentGenerateActionHost, AgentGenerationJobs } from './agent-generate-runtime.ts'
import { executeImportTool, type AgentImportJobs } from './agent-import-runtime.ts'
import type { AgentRefStore } from './agent-refs.ts'
import { executeRefTool } from './agent-refs-runtime.ts'
import { executeSpeechTool, type AgentSpeechJobs } from './agent-speech-runtime.ts'
import { executeLipSyncTool, type AgentLipSyncJobs } from './agent-lipsync-runtime.ts'
import { collectTimelineGaps, timelineDuration } from './agent-timeline-slice.ts'
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  toolErrorResult,
  validateUnknownKeys,
} from './agent-tool-utils.ts'
import {
  executeAssemblyTool,
  rememberAssemblyAcceptance,
  type AgentAssemblyMemory,
  type AgentAssemblyProgress,
} from './agent-assembly-runtime.ts'
import type { AgentAssemblyPreferredMedia, AgentAssemblyProposal } from './agent-assembly.ts'
import {
  defaultDurationForTextRole,
  parseTextRole,
  preferredTrackForTextRole,
  styleForTextRole,
  textStyleOverridesFromArgs,
} from './agent-text.ts'
import { executeGenerateTool } from './agent-generate-runtime.ts'
import { analyzeCut, applyNarrationSync, cutReportAsToolResult } from './agent-cut.ts'
import { normalizeEditPlan, type AgentEditPlan } from './agent-plan.ts'
import {
  EDIT_TOOL_ALLOWED_KEYS,
  NARRATIVE_TOOL_ALLOWED_KEYS,
  isAssemblyToolName,
  isGenerateToolName,
  isImportToolName,
  isNarrativeToolName,
  isRefToolName,
  isLipSyncToolName,
  isSpeechToolName,
  type AgentEditToolName,
  type AgentNarrativeToolName,
} from './tool-definitions.ts'

export const DELETE_MANY_THRESHOLD = 2

export interface AgentEditorActions {
  insertAssetsToTimeline: (state: EditorState, params: { assets: Asset[]; trackIndex?: number; startTime?: number }) => EditorState
  overwriteAssetsOnTimeline: (state: EditorState, params: { assets: Asset[]; trackIndex?: number; startTime?: number }) => EditorState
  splitClipsAtTime: (state: EditorState, clipIds: string[], time: number) => EditorState
  moveClips: (state: EditorState, params: { clipIds: string[]; deltaTime?: number; targetTrackIndex?: number }) => EditorState
  resizeClip: (state: EditorState, params: { clipId: string; edge: 'start' | 'end'; deltaTime: number }) => EditorState
  deleteClips: (state: EditorState, clipIds: string[]) => EditorState
  addTextClip: (state: EditorState, params: {
    style?: Partial<TextOverlayStyle>
    startTime?: number
    trackIndex?: number
  }) => EditorState
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
  setClipAudioLevel: (state: EditorState, clipId: string, volume: number) => EditorState
  undo: (state: EditorState) => EditorState
  setClipSpeed: (state: EditorState, clipId: string, speed: number) => EditorState
  slipClip: (state: EditorState, params: { clipId: string; deltaTime: number }) => EditorState
  slideClip: (state: EditorState, params: { clipId: string; deltaTime: number }) => EditorState
  duplicateClips: (state: EditorState, clipIds: string[]) => EditorState
  addTrack: (state: EditorState, kind: 'video' | 'audio') => EditorState
  deleteTrack: (state: EditorState, trackId: string) => EditorState
  renameTrack: (state: EditorState, trackId: string, name: string) => EditorState
  toggleTrackLock: (state: EditorState, trackId: string) => EditorState
  toggleTrackMute: (state: EditorState, trackId: string) => EditorState
  setClipOpacity: (state: EditorState, clipId: string, opacity: number) => EditorState
  toggleClipMute: (state: EditorState, clipId: string) => EditorState
  toggleClipReverse: (state: EditorState, clipId: string) => EditorState
  addCrossDissolve: (state: EditorState, leftClipId: string, rightClipId: string) => EditorState
  removeCrossDissolve: (state: EditorState, leftClipId: string, rightClipId: string) => EditorState
  switchActiveTimeline: (state: EditorState, timelineId: string | null) => EditorState
  renameTimeline: (state: EditorState, timelineId: string, name: string) => EditorState
  deleteTimeline: (state: EditorState, timelineId: string) => EditorState
  duplicateTimeline: (state: EditorState, timelineId: string) => EditorState
  setTimelineInPoint: (state: EditorState, time?: number | null) => EditorState
  setTimelineOutPoint: (state: EditorState, time?: number | null) => EditorState
  clearTimelineMarks: (state: EditorState) => EditorState
  updateSubtitle: (state: EditorState, subtitleId: string, patch: Partial<SubtitleClip>) => EditorState
  deleteSubtitle: (state: EditorState, subtitleId: string) => EditorState
  addAdjustmentLayer: (state: EditorState, params?: { startTime?: number; trackIndex?: number; duration?: number }) => EditorState
  unlinkClipGroup: (state: EditorState, clipId: string) => EditorState
}

export interface AgentToolExecutorHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  applyWithoutHistory: (fn: (state: EditorState) => EditorState) => void
  actions: AgentEditorActions
  generation?: AgentGenerationJobs
  importMedia?: AgentImportJobs
  speech?: AgentSpeechJobs
  lipsync?: AgentLipSyncJobs
  refs?: AgentRefStore
  getSelectedGap?: () => TimelineGapSelection | null
  projectId?: string
  getAbortSignal?: () => AbortSignal | null
  onProgress?: (progress: { toolName: string; percent: number; status: string }) => void
  getApproveAll?: () => boolean
  readAssetPreview?: AgentGenerateActionHost['readAssetPreview']
  getPreferredAssemblyMedia?: () => AgentAssemblyPreferredMedia
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
    ...(clip.type === 'text' && clip.textStyle ? {
      text: clip.textStyle.text,
      fontFamily: clip.textStyle.fontFamily,
      fontSize: clip.textStyle.fontSize,
      positionX: clip.textStyle.positionX,
      positionY: clip.textStyle.positionY,
      textAlign: clip.textStyle.textAlign,
    } : {}),
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

function defaultTrackIndex(state: EditorState, assets: Asset[], explicit: number | null): number {
  if (explicit != null) return explicit
  const allAudio = assets.length > 0 && assets.every(asset => asset.type === 'audio')
  if (!allAudio) return 0
  const audioIndex = activeTimeline(state)?.tracks.findIndex(track => track.kind === 'audio' && !track.locked) ?? -1
  return audioIndex >= 0 ? audioIndex : 0
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
  private lastAssemblyProposal: AgentAssemblyProposal | null = null
  private lastAssemblyConfirmedMore = false
  private lastAssemblyProgress: AgentAssemblyProgress | null = null
  private lastAssemblyReviewDecision: 'approve' | 'reject' | 'revise' | null = null
  private lastPlan: AgentEditPlan | null = null

  constructor(host: AgentToolExecutorHost) {
    this.host = host
  }

  resetAssistantUndo(): void {
    this.assistantUndo = []
  }

  private assemblyMemory(): AgentAssemblyMemory {
    return {
      getProposal: () => this.lastAssemblyProposal,
      setProposal: proposal => { this.lastAssemblyProposal = proposal },
      getConfirmedMore: () => this.lastAssemblyConfirmedMore,
      setConfirmedMore: value => { this.lastAssemblyConfirmedMore = value },
      getProgress: () => this.lastAssemblyProgress,
      setProgress: progress => { this.lastAssemblyProgress = progress },
      getReviewDecision: () => this.lastAssemblyReviewDecision,
      setReviewDecision: value => { this.lastAssemblyReviewDecision = value },
      getPlan: () => this.lastPlan,
      setPlan: plan => { this.lastPlan = plan },
    }
  }

  rememberAssemblyAcceptance(answers: Record<string, string | string[]>): void {
    rememberAssemblyAcceptance(this.assemblyMemory(), answers)
  }

  getLastPlan(): AgentEditPlan | null {
    return this.lastPlan
  }

  rememberPlan(plan: AgentEditPlan | null): void {
    this.lastPlan = plan
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
    if (isImportToolName(name)) {
      const before = undoSnapshot(this.host.getState())
      const result = await executeImportTool(this.host, name, args)
      if (result.ok !== false) {
        const after = undoSnapshot(this.host.getState())
        if (!sameUndoSnapshot(before, after)) {
          this.assistantUndo.push({ name, after })
        }
      }
      return result
    }
    if (isSpeechToolName(name)) {
      const before = undoSnapshot(this.host.getState())
      const result = await executeSpeechTool(this.host, name, args)
      if (result.ok !== false) {
        const after = undoSnapshot(this.host.getState())
        if (!sameUndoSnapshot(before, after)) {
          this.assistantUndo.push({ name, after })
        }
      }
      return result
    }
    if (isLipSyncToolName(name)) {
      const before = undoSnapshot(this.host.getState())
      const result = await executeLipSyncTool(this.host, name, args)
      if (result.ok !== false) {
        const after = undoSnapshot(this.host.getState())
        if (!sameUndoSnapshot(before, after)) {
          this.assistantUndo.push({ name, after })
        }
      }
      return result
    }
    if (isRefToolName(name)) {
      return executeRefTool(this.host, name, args)
    }
    if (isAssemblyToolName(name)) {
      const before = undoSnapshot(this.host.getState())
      const result = await executeAssemblyTool(this.host, name, args, this.assemblyMemory())
      if (result.ok !== false) {
        const after = undoSnapshot(this.host.getState())
        if (!sameUndoSnapshot(before, after)) {
          this.assistantUndo.push({ name, after })
        }
      }
      return result
    }
    if (isNarrativeToolName(name)) {
      return this.executeNarrative(name, args)
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
      case 'set_clip_volume':
        return this.setClipVolume(args)
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
      case 'set_clip_speed':
        return this.setClipSpeed(args)
      case 'slip_clip':
        return this.slipOrSlide(args, 'slip')
      case 'slide_clip':
        return this.slipOrSlide(args, 'slide')
      case 'duplicate_clips':
        return this.duplicateClips(args)
      case 'add_track':
        return this.addTrack(args)
      case 'delete_track':
        return this.mutateTrack(args, 'delete')
      case 'rename_track':
        return this.renameTrack(args)
      case 'toggle_track_lock':
        return this.mutateTrack(args, 'lock')
      case 'toggle_track_mute':
        return this.mutateTrack(args, 'mute')
      case 'set_clip_opacity':
        return this.setClipOpacity(args)
      case 'toggle_clip_mute':
        return this.toggleClipFlag(args, 'mute')
      case 'toggle_clip_reverse':
        return this.toggleClipFlag(args, 'reverse')
      case 'add_cross_dissolve':
        return this.crossDissolve(args, 'add')
      case 'remove_cross_dissolve':
        return this.crossDissolve(args, 'remove')
      case 'switch_timeline':
        return this.switchTimeline(args)
      case 'rename_timeline':
        return this.renameTimeline(args)
      case 'delete_timeline':
        return this.deleteTimeline(args)
      case 'duplicate_timeline':
        return this.duplicateTimeline(args)
      case 'set_in_point':
        return this.setMark(args, 'in')
      case 'set_out_point':
        return this.setMark(args, 'out')
      case 'clear_in_out':
        return this.clearMarks()
      case 'update_subtitle':
        return this.updateSubtitle(args)
      case 'delete_subtitle':
        return this.deleteSubtitle(args)
      case 'add_adjustment_layer':
        return this.addAdjustmentLayer(args)
      case 'unlink_clip_group':
        return this.unlinkClipGroup(args)
    }
  }

  private executeNarrative(name: AgentNarrativeToolName, args: Record<string, unknown>): Record<string, unknown> {
    const unknown = validateUnknownKeys(args, NARRATIVE_TOOL_ALLOWED_KEYS[name])
    if (unknown) return errorResult(unknown)
    if (name === 'plan_edit') {
      const plan = normalizeEditPlan(args)
      if ('error' in plan) return errorResult(plan.error)
      this.lastPlan = plan
      return { ok: true, plan, approveAllSkipsAskOnly: true }
    }
    if (name === 'check_cut') {
      return cutReportAsToolResult(analyzeCut(this.host.getState()))
    }
    const before = undoSnapshot(this.host.getState())
    const synced = applyNarrationSync(this.host)
    if (synced.synced) {
      const after = undoSnapshot(this.host.getState())
      if (!sameUndoSnapshot(before, after)) {
        this.assistantUndo.push({ name, after })
      }
    }
    return cutReportAsToolResult(synced.cut, {
      ok: synced.ok,
      synced: synced.synced,
      actions: synced.actions,
      needsGenerate: synced.needsGenerate,
      shortfall: synced.shortfall,
    })
  }

  private insertOrOverwrite(args: Record<string, unknown>, mode: 'insert' | 'overwrite'): Record<string, unknown> {
    const state = this.host.getState()
    const timeline = activeTimeline(state)
    if (!timeline) return errorResult('No active timeline')
    const resolved = resolveAssets(state, args.assetIds)
    if (!resolved.ok) return resolved.error
    const trackIndex = defaultTrackIndex(state, resolved.assets, asNumber(args.trackIndex))
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
    if (
      resolved.ids.length >= DELETE_MANY_THRESHOLD
      && !asBoolean(args.confirmed)
      && this.host.getApproveAll?.() !== true
    ) {
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
    const role = parseTextRole(args.role) ?? parseTextRole(args.preset) ?? 'title'
    const style = styleForTextRole(role, text, textStyleOverridesFromArgs(args))
    const trackIndex = asNumber(args.trackIndex) ?? preferredTrackForTextRole(role)
    const startTime = asNumber(args.startTime)
    const duration = asNumber(args.duration) ?? defaultDurationForTextRole(role)
    if (trackLocked(state, trackIndex)) return errorResult('Track is locked')
    const beforeIds = new Set(timeline.clips.map(item => item.id))
    const next = this.mutate(prev => {
      let current = this.host.actions.addTextClip(prev, {
        style,
        ...(startTime != null ? { startTime } : {}),
        trackIndex,
      })
      const created = activeTimeline(current)?.clips.find(item => !beforeIds.has(item.id))
      if (created && duration !== created.duration) {
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
    return timelineSlice(next, { clip: clipSlice(created), role })
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

  private setClipVolume(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const id = asString(args.clipId) ?? asString(args.id)
    if (!id) return errorResult('Missing clipId')
    const clip = clipById(state, id)
    if (!clip) return errorResult('Clip not found')
    if (trackLocked(state, clip.trackIndex)) return errorResult('Track is locked')
    const volume = asNumber(args.volume)
    if (volume == null) return errorResult('Missing volume')
    const next = this.mutate(prev => this.host.actions.setClipAudioLevel(prev, id, volume))
    const updated = clipById(next, id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
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

  private resolveClipId(args: Record<string, unknown>): { ok: true; id: string } | { ok: false; error: Record<string, unknown> } {
    const id = asString(args.clipId) ?? asString(args.id)
    if (!id) return { ok: false, error: errorResult('Missing clipId') }
    if (!clipById(this.host.getState(), id)) return { ok: false, error: errorResult('Clip not found') }
    return { ok: true, id }
  }

  private resolveTrackId(args: Record<string, unknown>): { ok: true; trackId: string } | { ok: false; error: Record<string, unknown> } {
    const timeline = activeTimeline(this.host.getState())
    if (!timeline) return { ok: false, error: errorResult('No active timeline') }
    const trackId = asString(args.trackId)
    if (trackId) {
      if (!timeline.tracks.some(track => track.id === trackId)) return { ok: false, error: errorResult('Track not found') }
      return { ok: true, trackId }
    }
    const index = asNumber(args.trackIndex)
    if (index == null) return { ok: false, error: errorResult('Missing trackId') }
    const track = timeline.tracks[index]
    if (!track) return { ok: false, error: errorResult('Track not found') }
    return { ok: true, trackId: track.id }
  }

  private resolveTimelineId(args: Record<string, unknown>, fallbackActive = true): { ok: true; id: string } | { ok: false; error: Record<string, unknown> } {
    const state = this.host.getState()
    const id = asString(args.timelineId) ?? asString(args.id) ?? (fallbackActive ? state.editorModel.activeTimelineId : null)
    if (!id) return { ok: false, error: errorResult('Missing timelineId') }
    if (!state.editorModel.timelines.some(timeline => timeline.id === id)) {
      return { ok: false, error: errorResult('Timeline not found') }
    }
    return { ok: true, id }
  }

  private setClipSpeed(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveClipId(args)
    if (!resolved.ok) return resolved.error
    const speed = asNumber(args.speed)
    if (speed == null || speed <= 0) return errorResult('speed must be a positive number')
    const clip = clipById(this.host.getState(), resolved.id)
    if (clip && trackLocked(this.host.getState(), clip.trackIndex)) return errorResult('Track is locked')
    const next = this.mutate(prev => this.host.actions.setClipSpeed(prev, resolved.id, speed))
    const updated = clipById(next, resolved.id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
  }

  private slipOrSlide(args: Record<string, unknown>, mode: 'slip' | 'slide'): Record<string, unknown> {
    const resolved = this.resolveClipId(args)
    if (!resolved.ok) return resolved.error
    const deltaTime = asNumber(args.deltaTime)
    if (deltaTime == null) return errorResult('Missing deltaTime')
    const clip = clipById(this.host.getState(), resolved.id)
    if (clip && trackLocked(this.host.getState(), clip.trackIndex)) return errorResult('Track is locked')
    const next = this.mutate(prev => (
      mode === 'slip'
        ? this.host.actions.slipClip(prev, { clipId: resolved.id, deltaTime })
        : this.host.actions.slideClip(prev, { clipId: resolved.id, deltaTime })
    ))
    const updated = clipById(next, resolved.id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
  }

  private duplicateClips(args: Record<string, unknown>): Record<string, unknown> {
    const state = this.host.getState()
    const resolved = resolveClipIds(state, args.clipIds)
    if (!resolved.ok) return resolved.error
    const locked = refuseIfLocked(state, resolved.ids)
    if (locked) return locked
    const beforeIds = new Set(activeTimeline(state)?.clips.map(item => item.id) ?? [])
    const next = this.mutate(prev => this.host.actions.duplicateClips(prev, resolved.ids))
    const created = (activeTimeline(next)?.clips ?? []).filter(item => !beforeIds.has(item.id)).map(clipSlice)
    return timelineSlice(next, { createdClipIds: created.map(item => item.id), created })
  }

  private addTrack(args: Record<string, unknown>): Record<string, unknown> {
    const kind = asString(args.kind)
    if (kind !== 'video' && kind !== 'audio') return errorResult('kind must be video or audio')
    const before = activeTimeline(this.host.getState())?.tracks.map(track => track.id) ?? []
    const next = this.mutate(prev => this.host.actions.addTrack(prev, kind))
    const created = activeTimeline(next)?.tracks.find(track => !before.includes(track.id))
    if (!created) return errorResult('Failed to add track')
    return timelineSlice(next, { track: { id: created.id, name: created.name, kind: created.kind } })
  }

  private mutateTrack(args: Record<string, unknown>, mode: 'delete' | 'lock' | 'mute'): Record<string, unknown> {
    const resolved = this.resolveTrackId(args)
    if (!resolved.ok) return resolved.error
    const next = this.mutate(prev => {
      if (mode === 'delete') return this.host.actions.deleteTrack(prev, resolved.trackId)
      if (mode === 'lock') return this.host.actions.toggleTrackLock(prev, resolved.trackId)
      return this.host.actions.toggleTrackMute(prev, resolved.trackId)
    })
    const timeline = activeTimeline(next)
    const track = timeline?.tracks.find(item => item.id === resolved.trackId)
    if (mode !== 'delete' && !track) return errorResult('Track not found')
    return timelineSlice(next, {
      trackId: resolved.trackId,
      ...(track ? { locked: track.locked, muted: track.muted, name: track.name } : { deleted: true }),
    })
  }

  private renameTrack(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveTrackId(args)
    if (!resolved.ok) return resolved.error
    const name = asString(args.name)
    if (!name) return errorResult('Missing name')
    const next = this.mutate(prev => this.host.actions.renameTrack(prev, resolved.trackId, name))
    return timelineSlice(next, { trackId: resolved.trackId, name })
  }

  private setClipOpacity(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveClipId(args)
    if (!resolved.ok) return resolved.error
    const opacity = asNumber(args.opacity)
    if (opacity == null) return errorResult('Missing opacity')
    const clip = clipById(this.host.getState(), resolved.id)
    if (clip && trackLocked(this.host.getState(), clip.trackIndex)) return errorResult('Track is locked')
    const next = this.mutate(prev => this.host.actions.setClipOpacity(prev, resolved.id, opacity))
    const updated = clipById(next, resolved.id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
  }

  private toggleClipFlag(args: Record<string, unknown>, mode: 'mute' | 'reverse'): Record<string, unknown> {
    const resolved = this.resolveClipId(args)
    if (!resolved.ok) return resolved.error
    const clip = clipById(this.host.getState(), resolved.id)
    if (clip && trackLocked(this.host.getState(), clip.trackIndex)) return errorResult('Track is locked')
    const next = this.mutate(prev => (
      mode === 'mute'
        ? this.host.actions.toggleClipMute(prev, resolved.id)
        : this.host.actions.toggleClipReverse(prev, resolved.id)
    ))
    const updated = clipById(next, resolved.id)
    if (!updated) return errorResult('Clip not found')
    return timelineSlice(next, { clip: clipSlice(updated) })
  }

  private crossDissolve(args: Record<string, unknown>, mode: 'add' | 'remove'): Record<string, unknown> {
    const left = asString(args.leftClipId)
    const right = asString(args.rightClipId)
    if (!left || !right) return errorResult('Missing leftClipId or rightClipId')
    const state = this.host.getState()
    if (!clipById(state, left) || !clipById(state, right)) return errorResult('Clip not found')
    const next = this.mutate(prev => (
      mode === 'add'
        ? this.host.actions.addCrossDissolve(prev, left, right)
        : this.host.actions.removeCrossDissolve(prev, left, right)
    ))
    return timelineSlice(next, { leftClipId: left, rightClipId: right, dissolve: mode === 'add' })
  }

  private switchTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveTimelineId(args, false)
    if (!resolved.ok) return resolved.error
    const next = this.mutate(prev => this.host.actions.switchActiveTimeline(prev, resolved.id))
    return { ok: true, timelineId: next.editorModel.activeTimelineId }
  }

  private renameTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveTimelineId(args)
    if (!resolved.ok) return resolved.error
    const name = asString(args.name)
    if (!name) return errorResult('Missing name')
    const next = this.mutate(prev => this.host.actions.renameTimeline(prev, resolved.id, name))
    const timeline = next.editorModel.timelines.find(item => item.id === resolved.id)
    return { ok: true, timelineId: resolved.id, name: timeline?.name ?? name }
  }

  private deleteTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveTimelineId(args)
    if (!resolved.ok) return resolved.error
    if (!asBoolean(args.confirmed) && this.host.getApproveAll?.() !== true) {
      return {
        ok: false,
        needsConfirm: true,
        timelineId: resolved.id,
        error: 'Deleting a timeline needs confirmation. Use ask_user, then call delete_timeline with confirmed=true.',
      }
    }
    if (this.host.getState().editorModel.timelines.length <= 1) {
      return errorResult('Cannot delete the last timeline')
    }
    const next = this.mutate(prev => this.host.actions.deleteTimeline(prev, resolved.id))
    return {
      ok: true,
      deletedTimelineId: resolved.id,
      activeTimelineId: next.editorModel.activeTimelineId,
    }
  }

  private duplicateTimeline(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveTimelineId(args)
    if (!resolved.ok) return resolved.error
    const before = new Set(this.host.getState().editorModel.timelines.map(timeline => timeline.id))
    const next = this.mutate(prev => this.host.actions.duplicateTimeline(prev, resolved.id))
    const created = next.editorModel.timelines.find(timeline => !before.has(timeline.id))
    if (!created) return errorResult('Failed to duplicate timeline')
    return { ok: true, timelineId: created.id, name: created.name }
  }

  private setMark(args: Record<string, unknown>, edge: 'in' | 'out'): Record<string, unknown> {
    const time = asNumber(args.time) ?? this.host.getState().session.transport.currentTime
    const next = this.mutate(prev => (
      edge === 'in'
        ? this.host.actions.setTimelineInPoint(prev, time)
        : this.host.actions.setTimelineOutPoint(prev, time)
    ))
    return {
      ok: true,
      playhead: next.session.transport.currentTime,
      mark: edge,
      time,
    }
  }

  private clearMarks(): Record<string, unknown> {
    this.mutate(prev => this.host.actions.clearTimelineMarks(prev))
    return { ok: true, inPoint: null, outPoint: null }
  }

  private updateSubtitle(args: Record<string, unknown>): Record<string, unknown> {
    const id = asString(args.id) ?? asString(args.subtitleId)
    if (!id) return errorResult('Missing id')
    const timeline = activeTimeline(this.host.getState())
    if (!timeline?.subtitles.some(subtitle => subtitle.id === id)) return errorResult('Subtitle not found')
    const patch: Partial<SubtitleClip> = {}
    const text = asString(args.text)
    const start = asNumber(args.start) ?? asNumber(args.startTime)
    const end = asNumber(args.end) ?? asNumber(args.endTime)
    if (text) patch.text = text
    if (start != null) patch.startTime = start
    if (end != null) patch.endTime = end
    if (Object.keys(patch).length === 0) return errorResult('Provide text, start, or end')
    const next = this.mutate(prev => this.host.actions.updateSubtitle(prev, id, patch))
    const updated = activeTimeline(next)?.subtitles.find(subtitle => subtitle.id === id)
    return timelineSlice(next, {
      subtitle: updated
        ? { id: updated.id, text: updated.text, start: updated.startTime, end: updated.endTime }
        : { id },
    })
  }

  private deleteSubtitle(args: Record<string, unknown>): Record<string, unknown> {
    const id = asString(args.id) ?? asString(args.subtitleId)
    if (!id) return errorResult('Missing id')
    const next = this.mutate(prev => this.host.actions.deleteSubtitle(prev, id))
    return timelineSlice(next, { deletedSubtitleId: id })
  }

  private addAdjustmentLayer(args: Record<string, unknown>): Record<string, unknown> {
    const startTime = asNumber(args.startTime)
    const trackIndex = asNumber(args.trackIndex)
    const duration = asNumber(args.duration)
    if (trackIndex != null && trackLocked(this.host.getState(), trackIndex)) return errorResult('Track is locked')
    const beforeIds = new Set(activeTimeline(this.host.getState())?.clips.map(item => item.id) ?? [])
    const next = this.mutate(prev => this.host.actions.addAdjustmentLayer(prev, {
      ...(startTime != null ? { startTime } : {}),
      ...(trackIndex != null ? { trackIndex } : {}),
      ...(duration != null ? { duration } : {}),
    }))
    const created = (activeTimeline(next)?.clips ?? []).find(item => !beforeIds.has(item.id))
    if (!created) return errorResult('Failed to add adjustment layer')
    return timelineSlice(next, { clip: clipSlice(created) })
  }

  private unlinkClipGroup(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = this.resolveClipId(args)
    if (!resolved.ok) return resolved.error
    const next = this.mutate(prev => this.host.actions.unlinkClipGroup(prev, resolved.id))
    return timelineSlice(next, { clipId: resolved.id, unlinked: true })
  }
}
