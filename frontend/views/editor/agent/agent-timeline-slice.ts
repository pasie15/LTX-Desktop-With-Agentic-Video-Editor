import type { TimelineClip, Track } from '../../../types/project-model.ts'
import { AGENT_TIMELINE_WINDOW_S } from './agent-types.ts'

const GAP_EPSILON = 0.05

export function timelineDuration(clips: TimelineClip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
}

export function collectTimelineGaps(tracks: Track[], clips: TimelineClip[]): Array<{
  trackIndex: number
  start: number
  end: number
}> {
  const gaps: Array<{ trackIndex: number; start: number; end: number }> = []
  tracks.forEach((track, trackIndex) => {
    if (track.type === 'subtitle') return
    const trackClips = clips
      .filter(clip => clip.trackIndex === trackIndex)
      .sort((left, right) => left.startTime - right.startTime)
    if (trackClips.length === 0) return
    if (trackClips[0].startTime > GAP_EPSILON) {
      gaps.push({ trackIndex, start: 0, end: trackClips[0].startTime })
    }
    for (let index = 0; index < trackClips.length - 1; index++) {
      const endOfCurrent = trackClips[index].startTime + trackClips[index].duration
      const startOfNext = trackClips[index + 1].startTime
      if (startOfNext - endOfCurrent > GAP_EPSILON) {
        gaps.push({ trackIndex, start: endOfCurrent, end: startOfNext })
      }
    }
  })
  return gaps
}

export function filterClipsToWindow(
  clips: TimelineClip[],
  playhead: number,
  windowSeconds: number = AGENT_TIMELINE_WINDOW_S,
): { clips: TimelineClip[]; windowed: boolean } {
  if (clips.length === 0) return { clips, windowed: false }
  const start = playhead - windowSeconds
  const end = playhead + windowSeconds
  const filtered = clips.filter(clip => {
    const clipEnd = clip.startTime + clip.duration
    return clipEnd >= start && clip.startTime <= end
  })
  return {
    clips: filtered,
    windowed: filtered.length < clips.length,
  }
}
