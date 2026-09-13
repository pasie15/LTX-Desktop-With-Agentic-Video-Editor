import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDefaultTimeline, DEFAULT_COLOR_CORRECTION, DEFAULT_TRACKS, type TimelineClip } from '../../../types/project-model.ts'
import { DEFAULT_LAYOUT } from '../editor-layout.ts'
import type { EditorState } from '../editor-state.ts'
import { analyzeCut, scaleShotsToCoverDuration } from './agent-cut.ts'

function clip(partial: Pick<TimelineClip, 'id' | 'startTime' | 'duration' | 'trackIndex'> & { type?: TimelineClip['type'] }): TimelineClip {
  return {
    assetId: 'asset-1',
    type: 'video',
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    opacity: 100,
    ...partial,
  }
}

function stateWith(clips: TimelineClip[]): EditorState {
  const timeline = createDefaultTimeline('Timeline 1')
  timeline.id = 'tl1'
  timeline.tracks = DEFAULT_TRACKS.map(track => ({ ...track }))
  timeline.clips = clips
  return {
    editorModel: {
      assets: [],
      bins: {},
      timelines: [timeline],
      activeTimelineId: 'tl1',
    },
    session: {
      selection: { clipIds: new Set(), subtitleId: null, editingSubtitleId: null, gap: null },
      transport: {
        currentTime: 0,
        isPlaying: false,
        shuttleSpeed: 0,
        playingInOut: false,
        timelineInOutMap: {},
      },
      tools: { zoom: 1, snapEnabled: true, activeTool: 'select', lastTrimTool: 'ripple' },
      ui: {
        showImportTimelineModal: false,
        showExportModal: false,
        showSourceMonitor: false,
        showPropertiesPanel: false,
        showAgentChat: false,
        showEffectsBrowser: false,
        activeFocusArea: 'timeline',
        sourceSplitPercent: 50,
        hasSourceAsset: false,
        openTimelineIds: new Set(['tl1']),
        renamingTimelineId: null,
        renameValue: '',
        renameSource: 'tab',
        layout: { ...DEFAULT_LAYOUT },
        subtitleTrackStyleIdx: null,
        gapGenerateMode: null,
      },
      regeneration: { regeneratingAssetId: null, regeneratingClipId: null, preError: null },
      clipboard: { kind: null, clips: [], copiedFromTimelineId: null },
    },
    history: { undoStack: [], redoStack: [] },
    projectSync: { dirty: false },
  }
}

describe('narrative cut', () => {
  it('reports a 10s VO on 4s of picture', () => {
    const cut = analyzeCut(stateWith([
      clip({ id: 'pic', startTime: 0, duration: 4, trackIndex: 0 }),
      clip({ id: 'vo', startTime: 0, duration: 10, trackIndex: 3, type: 'audio' }),
    ]))
    assert.equal(cut.ok, false)
    assert.equal(cut.pictureDuration, 4)
    assert.equal(cut.voiceoverDuration, 10)
    assert.equal(cut.mismatches[0]?.kind, 'picture_short')
  })

  it('is ok when picture covers VO', () => {
    const cut = analyzeCut(stateWith([
      clip({ id: 'pic', startTime: 0, duration: 10, trackIndex: 0 }),
      clip({ id: 'vo', startTime: 0, duration: 10, trackIndex: 3, type: 'audio' }),
    ]))
    assert.equal(cut.ok, true)
    assert.equal(cut.delta, 0)
  })

  it('scales the last shot so generated picture covers VO', () => {
    const shots = scaleShotsToCoverDuration([
      { prompt: 'a', duration: 4 },
      { prompt: 'b', duration: 4 },
    ], 12)
    assert.equal(shots[0]?.duration, 4)
    assert.equal(shots[1]?.duration, 7)
  })
})
