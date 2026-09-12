import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_TRACKS, type TimelineClip } from '../../../types/project-model.ts'
import { collectTimelineGaps, filterClipsToWindow, timelineDuration } from './agent-timeline-slice.ts'

function clip(partial: Pick<TimelineClip, 'id' | 'startTime' | 'duration' | 'trackIndex'>): TimelineClip {
  return {
    assetId: 'asset-1',
    type: 'video',
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 100,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0.5 },
    transitionOut: { type: 'none', duration: 0.5 },
    colorCorrection: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
    },
    opacity: 100,
    ...partial,
  }
}

describe('agent snapshot', () => {
  it('computes duration and gaps the same way as the timeline panel', () => {
    const clips = [
      clip({ id: 'c1', startTime: 1, duration: 2, trackIndex: 0 }),
      clip({ id: 'c2', startTime: 5, duration: 2, trackIndex: 0 }),
    ]
    assert.equal(timelineDuration(clips), 7)
    assert.deepEqual(collectTimelineGaps(DEFAULT_TRACKS, clips), [
      { trackIndex: 0, start: 0, end: 1 },
      { trackIndex: 0, start: 3, end: 5 },
    ])
  })

  it('windows clips around the playhead', () => {
    const clips = [
      clip({ id: 'early', startTime: 0, duration: 2, trackIndex: 0 }),
      clip({ id: 'near', startTime: 40, duration: 2, trackIndex: 0 }),
    ]
    const windowed = filterClipsToWindow(clips, 40, 10)
    assert.equal(windowed.windowed, true)
    assert.deepEqual(windowed.clips.map(item => item.id), ['near'])
  })
})
