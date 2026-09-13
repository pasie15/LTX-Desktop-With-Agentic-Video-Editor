import type { Timeline, TimelineClip } from '../../../types/project-model.ts'
import type { EditorState } from '../editor-state.ts'
import {
  AGENT_MUSIC_TRACK_INDEX,
  AGENT_VOICEOVER_TRACK_INDEX,
} from './agent-mix.ts'

export const CUT_MATCH_TOLERANCE_S = 0.35
export const MIN_SYNC_SPEED = 0.8
export const MAX_SYNC_SPEED = 1.25

export type AgentCutMismatchKind = 'picture_short' | 'picture_long' | 'picture_gap'

export interface AgentCutMismatch {
  kind: AgentCutMismatchKind
  pictureDuration: number
  voiceoverDuration: number
  delta: number
  suggest: string[]
}

export interface AgentCutReport {
  ok: boolean
  pictureStart: number
  pictureEnd: number
  pictureDuration: number
  voiceoverStart: number
  voiceoverEnd: number
  voiceoverDuration: number
  musicDuration: number
  delta: number
  gaps: Array<{ start: number; end: number }>
  mismatches: AgentCutMismatch[]
  pictureClipIds: string[]
  voiceoverClipIds: string[]
  lastPictureClipId?: string
}

export interface AgentCutSyncHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  actions: {
    resizeClip: (state: EditorState, params: { clipId: string; edge: 'start' | 'end'; deltaTime: number }) => EditorState
    setClipSpeed?: (state: EditorState, clipId: string, speed: number) => EditorState
    splitClipsAtTime?: (state: EditorState, clipIds: string[], time: number) => EditorState
  }
}

function activeTimeline(state: EditorState): Timeline | null {
  if (state.editorModel.timelines.length === 0) return null
  return state.editorModel.timelines.find(timeline => timeline.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
}

function isPictureClip(clip: TimelineClip, tracks: Timeline['tracks']): boolean {
  if (clip.type === 'text' || clip.type === 'audio' || clip.type === 'adjustment') return false
  const track = tracks[clip.trackIndex]
  if (!track || track.type === 'subtitle' || track.kind === 'audio') return false
  return clip.type === 'video' || clip.type === 'image'
}

function spanOf(clips: TimelineClip[]): { start: number; end: number; duration: number; ids: string[] } {
  if (clips.length === 0) {
    return { start: 0, end: 0, duration: 0, ids: [] }
  }
  const start = clips.reduce((min, clip) => Math.min(min, clip.startTime), Number.POSITIVE_INFINITY)
  const end = clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
  return {
    start: Number.isFinite(start) ? start : 0,
    end,
    duration: Math.max(0, end - (Number.isFinite(start) ? start : 0)),
    ids: clips.map(clip => clip.id),
  }
}

function pictureGaps(clips: TimelineClip[], start: number, end: number): Array<{ start: number; end: number }> {
  if (end <= start) return []
  const ordered = [...clips].sort((left, right) => left.startTime - right.startTime)
  const gaps: Array<{ start: number; end: number }> = []
  let cursor = start
  for (const clip of ordered) {
    const clipStart = clip.startTime
    const clipEnd = clip.startTime + clip.duration
    if (clipStart > cursor + 0.05) gaps.push({ start: cursor, end: clipStart })
    cursor = Math.max(cursor, clipEnd)
  }
  if (end > cursor + 0.05) gaps.push({ start: cursor, end })
  return gaps
}

export function analyzeCut(state: EditorState): AgentCutReport {
  const timeline = activeTimeline(state)
  const empty: AgentCutReport = {
    ok: true,
    pictureStart: 0,
    pictureEnd: 0,
    pictureDuration: 0,
    voiceoverStart: 0,
    voiceoverEnd: 0,
    voiceoverDuration: 0,
    musicDuration: 0,
    delta: 0,
    gaps: [],
    mismatches: [],
    pictureClipIds: [],
    voiceoverClipIds: [],
  }
  if (!timeline) return empty

  const picture = timeline.clips.filter(clip => isPictureClip(clip, timeline.tracks))
  const voTrack = timeline.tracks[AGENT_VOICEOVER_TRACK_INDEX]?.kind === 'audio'
    ? AGENT_VOICEOVER_TRACK_INDEX
    : timeline.tracks.findIndex(track => track.kind === 'audio')
  const musicTrack = timeline.tracks[AGENT_MUSIC_TRACK_INDEX]?.kind === 'audio'
    ? AGENT_MUSIC_TRACK_INDEX
    : timeline.tracks.findIndex((track, index) => track.kind === 'audio' && index !== voTrack)
  const voiceover = voTrack >= 0
    ? timeline.clips.filter(clip => clip.type === 'audio' && clip.trackIndex === voTrack)
    : []
  const music = musicTrack >= 0
    ? timeline.clips.filter(clip => clip.type === 'audio' && clip.trackIndex === musicTrack)
    : []

  const pictureSpan = spanOf(picture)
  const voSpan = spanOf(voiceover)
  const musicSpan = spanOf(music)
  const coverEnd = Math.max(pictureSpan.end, voSpan.end)
  const gaps = pictureGaps(picture, pictureSpan.start, Math.max(pictureSpan.end, voSpan.end))
  const delta = pictureSpan.duration - voSpan.duration
  const mismatches: AgentCutMismatch[] = []

  if (voSpan.duration > 0 && pictureSpan.duration + CUT_MATCH_TOLERANCE_S < voSpan.duration) {
    mismatches.push({
      kind: 'picture_short',
      pictureDuration: pictureSpan.duration,
      voiceoverDuration: voSpan.duration,
      delta,
      suggest: ['extend last picture clip', 'slow speed 0.8–1.0', 'generate extra shot', 'sync_narration'],
    })
  }
  if (voSpan.duration > 0 && pictureSpan.duration > voSpan.duration + CUT_MATCH_TOLERANCE_S) {
    mismatches.push({
      kind: 'picture_long',
      pictureDuration: pictureSpan.duration,
      voiceoverDuration: voSpan.duration,
      delta,
      suggest: ['trim last picture clip', 'speed up 1.0–1.25', 'sync_narration'],
    })
  }
  if (voSpan.duration > 0 && gaps.some(gap => gap.end > pictureSpan.start && gap.start < coverEnd)) {
    const uncovered = gaps.filter(gap => gap.end - gap.start > CUT_MATCH_TOLERANCE_S)
    if (uncovered.length > 0 && !mismatches.some(item => item.kind === 'picture_gap')) {
      mismatches.push({
        kind: 'picture_gap',
        pictureDuration: pictureSpan.duration,
        voiceoverDuration: voSpan.duration,
        delta,
        suggest: ['extend neighboring clip', 'generate extra to fill gap', 'sync_narration'],
      })
    }
  }

  const lastPicture = [...picture].sort((left, right) => (
    (left.startTime + left.duration) - (right.startTime + right.duration)
  )).at(-1)

  return {
    ok: mismatches.length === 0,
    pictureStart: pictureSpan.start,
    pictureEnd: pictureSpan.end,
    pictureDuration: pictureSpan.duration,
    voiceoverStart: voSpan.start,
    voiceoverEnd: voSpan.end,
    voiceoverDuration: voSpan.duration,
    musicDuration: musicSpan.duration,
    delta,
    gaps,
    mismatches,
    pictureClipIds: pictureSpan.ids,
    voiceoverClipIds: voSpan.ids,
    ...(lastPicture ? { lastPictureClipId: lastPicture.id } : {}),
  }
}

export function scaleShotsToCoverDuration<T extends { duration: number; assetId?: string }>(
  shots: readonly T[],
  targetDuration: number,
  generatedMinimum = 5,
): T[] {
  if (shots.length === 0 || !(targetDuration > 0)) return [...shots]
  const estimated = (shot: T) => (
    shot.assetId ? shot.duration : Math.max(shot.duration, generatedMinimum)
  )
  const total = shots.reduce((sum, shot) => sum + estimated(shot), 0)
  if (total >= targetDuration - CUT_MATCH_TOLERANCE_S) return [...shots]
  const last = shots[shots.length - 1]!
  const deficit = targetDuration - total
  return [
    ...shots.slice(0, -1),
    { ...last, duration: estimated(last) + deficit },
  ]
}

function clipById(state: EditorState, id: string): TimelineClip | undefined {
  return activeTimeline(state)?.clips.find(clip => clip.id === id)
}

function extendClipEnd(
  host: AgentCutSyncHost,
  clipId: string,
  deltaTime: number,
): void {
  if (Math.abs(deltaTime) < 0.001) return
  host.applyWithHistory(prev => host.actions.resizeClip(prev, {
    clipId,
    edge: 'end',
    deltaTime,
  }))
}

function setSpeedAndDuration(
  host: AgentCutSyncHost,
  clipId: string,
  speed: number,
  duration: number,
): void {
  const live = clipById(host.getState(), clipId)
  if (!live) return
  const nextSpeed = Math.min(MAX_SYNC_SPEED, Math.max(MIN_SYNC_SPEED, speed))
  if (host.actions.setClipSpeed && nextSpeed !== live.speed) {
    host.applyWithHistory(prev => host.actions.setClipSpeed!(prev, clipId, nextSpeed))
  }
  const after = clipById(host.getState(), clipId)
  if (after && Math.abs(after.duration - duration) >= 0.001) {
    extendClipEnd(host, clipId, duration - after.duration)
  }
}

export function applyNarrationSync(host: AgentCutSyncHost): {
  ok: boolean
  synced: boolean
  actions: string[]
  cut: AgentCutReport
  needsGenerate: boolean
  shortfall: number
} {
  const actions: string[] = []
  const before = analyzeCut(host.getState())
  if (before.ok) {
    return { ok: true, synced: false, actions, cut: before, needsGenerate: false, shortfall: 0 }
  }
  if (before.voiceoverDuration <= 0) {
    return {
      ok: false,
      synced: false,
      actions,
      cut: before,
      needsGenerate: false,
      shortfall: 0,
    }
  }
  if (!before.lastPictureClipId || before.pictureDuration <= 0) {
    return {
      ok: true,
      synced: false,
      actions,
      cut: before,
      needsGenerate: true,
      shortfall: before.voiceoverDuration,
    }
  }

  const lastId = before.lastPictureClipId
  const last = clipById(host.getState(), lastId)
  if (!last) {
    return {
      ok: false,
      synced: false,
      actions,
      cut: before,
      needsGenerate: true,
      shortfall: before.voiceoverDuration,
    }
  }

  const targetEnd = before.voiceoverStart + before.voiceoverDuration
  const currentEnd = last.startTime + last.duration
  const deltaEnd = targetEnd - currentEnd

  if (Math.abs(deltaEnd) > CUT_MATCH_TOLERANCE_S) {
    if (deltaEnd > 0) {
      extendClipEnd(host, lastId, deltaEnd)
      actions.push(`extend ${lastId} by ${deltaEnd.toFixed(2)}s`)
    } else {
      const nextDuration = last.duration + deltaEnd
      if (nextDuration >= 0.1) {
        extendClipEnd(host, lastId, deltaEnd)
        actions.push(`trim ${lastId} by ${(-deltaEnd).toFixed(2)}s`)
      } else {
        const speed = Math.min(MAX_SYNC_SPEED, last.duration / Math.max(0.1, last.duration + deltaEnd))
        const visual = last.duration / speed
        setSpeedAndDuration(host, lastId, speed, visual)
        actions.push(`speed ${lastId} to ${speed.toFixed(2)}x`)
        const afterSpeed = clipById(host.getState(), lastId)
        if (afterSpeed) {
          const remain = targetEnd - (afterSpeed.startTime + afterSpeed.duration)
          if (remain < -CUT_MATCH_TOLERANCE_S && afterSpeed.duration + remain >= 0.1) {
            extendClipEnd(host, lastId, remain)
            actions.push(`trim ${lastId} by ${(-remain).toFixed(2)}s`)
          }
        }
      }
    }
  }

  let cut = analyzeCut(host.getState())
  if (!cut.ok && cut.lastPictureClipId && cut.voiceoverDuration > cut.pictureDuration + CUT_MATCH_TOLERANCE_S) {
    const remain = cut.voiceoverDuration - cut.pictureDuration
    const live = clipById(host.getState(), cut.lastPictureClipId)
    if (live) {
      const speed = Math.max(MIN_SYNC_SPEED, live.duration / (live.duration + remain))
      const visual = live.duration / speed
      setSpeedAndDuration(host, cut.lastPictureClipId, speed, visual)
      actions.push(`speed ${cut.lastPictureClipId} to ${speed.toFixed(2)}x`)
      cut = analyzeCut(host.getState())
    }
  }

  const shortfall = cut.ok ? 0 : Math.max(0, cut.voiceoverDuration - cut.pictureDuration)
  return {
    ok: cut.ok || shortfall <= CUT_MATCH_TOLERANCE_S,
    synced: actions.length > 0,
    actions,
    cut,
    needsGenerate: shortfall > CUT_MATCH_TOLERANCE_S,
    shortfall,
  }
}

export function cutReportAsToolResult(cut: AgentCutReport, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: extras.ok ?? cut.ok,
    pictureStart: cut.pictureStart,
    pictureEnd: cut.pictureEnd,
    pictureDuration: cut.pictureDuration,
    voiceoverStart: cut.voiceoverStart,
    voiceoverEnd: cut.voiceoverEnd,
    voiceoverDuration: cut.voiceoverDuration,
    musicDuration: cut.musicDuration,
    delta: cut.delta,
    gaps: cut.gaps,
    mismatches: cut.mismatches,
    pictureClipIds: cut.pictureClipIds,
    voiceoverClipIds: cut.voiceoverClipIds,
    ...(cut.lastPictureClipId ? { lastPictureClipId: cut.lastPictureClipId } : {}),
    ...extras,
  }
}
