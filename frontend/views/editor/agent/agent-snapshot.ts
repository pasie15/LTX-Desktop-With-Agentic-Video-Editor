import type { Asset, Timeline } from '../../../types/project-model'
import type { EditorState, TimelineGapSelection } from '../editor-state'
import {
  selectActiveTimeline,
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectAssetBins,
  selectAssets,
  selectSelectedClipIds,
  selectSelectedGap,
  selectTimelines,
} from '../editor-selectors'
import { analyzeCut } from './agent-cut'
import { collectTimelineGaps, filterClipsToWindow, timelineDuration } from './agent-timeline-slice'
import type { AgentEditPlan } from './agent-plan'
import type { AgentRef } from './agent-refs'
import type { AgentProjectSnapshot } from './agent-types'

export { collectTimelineGaps, filterClipsToWindow, timelineDuration } from './agent-timeline-slice'

function assetDisplayName(asset: Asset): string {
  const prompt = asset.prompt.trim()
  if (prompt) return prompt
  return asset.id
}

function compactAsset(asset: Asset, bins: Map<string, string>) {
  const item: AgentProjectSnapshot['assets'][number] = {
    id: asset.id,
    type: asset.type,
    name: assetDisplayName(asset),
  }
  if (asset.duration != null) item.duration = asset.duration
  if (asset.resolution) item.resolution = asset.resolution
  if (asset.binId) item.bin = bins.get(asset.binId) || asset.binId
  if (asset.favorite) item.favorite = true
  if (asset.generationParams?.prompt) item.prompt = asset.generationParams.prompt
  else if (asset.prompt) item.prompt = asset.prompt
  return item
}

function compactTimelineSummary(timeline: Timeline, activeId: string | null) {
  const summary: AgentProjectSnapshot['timelines'][number] = {
    id: timeline.id,
    name: timeline.name,
    clipCount: timeline.clips.length,
    duration: timelineDuration(timeline.clips),
  }
  if (timeline.id === activeId) summary.active = true
  return summary
}

function compactGap(gap: TimelineGapSelection) {
  return { trackIndex: gap.trackIndex, start: gap.startTime, end: gap.endTime }
}

export interface BuildAgentSnapshotInput {
  state: EditorState
  projectId: string
  projectName: string
  generationBusy: boolean
  generationCanCancel: boolean
  currentModelLabel: string
  selectedGapOverride?: TimelineGapSelection | null
  refs?: AgentRef[]
  approveAll?: boolean
  plan?: AgentEditPlan | null
}

export function buildAgentSnapshot(input: BuildAgentSnapshotInput): AgentProjectSnapshot {
  const { state, projectId, projectName } = input
  const assets = selectAssets(state)
  const bins = new Map(selectAssetBins(state).map(bin => [bin.id, bin.name]))
  const timelines = selectTimelines(state)
  const active = selectActiveTimeline(state)
  const playhead = state.session.transport.currentTime
  const selectedGap = input.selectedGapOverride ?? selectSelectedGap(state)

  let activeTimeline: AgentProjectSnapshot['activeTimeline'] = null
  if (active) {
    const windowedClips = filterClipsToWindow(active.clips, playhead)
    activeTimeline = {
      id: active.id,
      name: active.name,
      duration: timelineDuration(active.clips),
      windowed: windowedClips.windowed,
      tracks: active.tracks
        .filter(track => track.type !== 'subtitle')
        .map(track => ({
          id: track.id,
          name: track.name,
          kind: track.kind,
          locked: track.locked,
          muted: track.muted,
        })),
      clips: windowedClips.clips.map(clip => ({
        id: clip.id,
        assetId: clip.assetId,
        track: clip.trackIndex,
        start: clip.startTime,
        duration: clip.duration,
        type: clip.type,
      })),
      subtitleCount: active.subtitles.length,
      gaps: collectTimelineGaps(active.tracks, active.clips),
    }
  }

  return {
    project: { id: projectId, name: projectName },
    assets: assets.map(asset => compactAsset(asset, bins)),
    timelines: timelines.map(timeline => compactTimelineSummary(timeline, state.editorModel.activeTimelineId)),
    activeTimeline,
    session: {
      playhead,
      inPoint: selectActiveTimelineInPoint(state),
      outPoint: selectActiveTimelineOutPoint(state),
      selectedClipIds: [...selectSelectedClipIds(state)],
      selectedGap: selectedGap ? compactGap(selectedGap) : null,
    },
    generation: {
      busy: input.generationBusy,
      canCancel: input.generationCanCancel,
      currentModelLabel: input.currentModelLabel,
    },
    refs: (input.refs ?? []).map(ref => ({
      id: ref.id,
      name: ref.name,
      role: ref.role,
      assetId: ref.assetId,
    })),
    approveAll: input.approveAll === true,
    plan: input.plan
      ? {
          goal: input.plan.goal,
          shots: input.plan.shots,
          voStrategy: input.plan.voStrategy,
          timing: input.plan.timing,
          checks: input.plan.checks,
        }
      : null,
    cut: (() => {
      const cut = analyzeCut(state)
      return {
        ok: cut.ok,
        pictureDuration: cut.pictureDuration,
        voiceoverDuration: cut.voiceoverDuration,
        delta: cut.delta,
        mismatches: cut.mismatches.map(item => ({ kind: item.kind, delta: item.delta })),
      }
    })(),
  }
}
