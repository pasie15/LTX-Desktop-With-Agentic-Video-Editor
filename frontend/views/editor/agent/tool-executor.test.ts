import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDefaultTimeline, DEFAULT_COLOR_CORRECTION, DEFAULT_TRACKS, type Asset, type TimelineClip } from '../../../types/project-model.ts'
import * as editorActions from '../editor-actions.ts'
import {
  createInitialEditorState,
  equalUndoSnapshot,
  getUndoSnapshot,
  type EditorState,
} from '../editor-state.ts'
import { selectActiveTimeline } from '../editor-selectors.ts'
import { listGenerationModels, validateUnknownKeys } from './agent-tool-utils.ts'
import { AgentToolExecutor, type AgentToolExecutorHost } from './tool-executor.ts'

function videoAsset(id: string, duration = 4): Asset {
  return {
    id,
    type: 'video',
    path: `/tmp/${id}.mp4`,
    prompt: id,
    resolution: '1080p',
    duration,
    createdAt: 1,
  }
}

function clip(partial: Pick<TimelineClip, 'id' | 'startTime' | 'duration' | 'trackIndex'> & { assetId?: string }): TimelineClip {
  return {
    assetId: partial.assetId ?? 'asset-1',
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

function makeState(overrides?: {
  clips?: TimelineClip[]
  assets?: Asset[]
  bins?: Record<string, string>
  selectedClipIds?: string[]
  playhead?: number
  lockTrack0?: boolean
}): EditorState {
  const timeline = createDefaultTimeline('Timeline 1')
  timeline.id = 'tl1'
  timeline.tracks = DEFAULT_TRACKS.map(track => ({ ...track, locked: Boolean(overrides?.lockTrack0 && track.id === 'track-v1') }))
  timeline.clips = overrides?.clips ?? [
    clip({ id: 'c1', startTime: 0, duration: 4, trackIndex: 0 }),
  ]
  const state = createInitialEditorState({
    assets: overrides?.assets ?? [videoAsset('asset-1'), videoAsset('asset-2', 3)],
    bins: overrides?.bins ?? {},
    timelines: [timeline],
    activeTimelineId: 'tl1',
  })
  return {
    ...state,
    session: {
      ...state.session,
      selection: {
        ...state.session.selection,
        clipIds: new Set(overrides?.selectedClipIds ?? []),
      },
      transport: {
        ...state.session.transport,
        currentTime: overrides?.playhead ?? 2,
      },
    },
  }
}

function recordHistoryStep(prev: EditorState, next: EditorState): EditorState {
  if (next === prev) return prev
  const beforeSnapshot = getUndoSnapshot(prev)
  const afterSnapshot = getUndoSnapshot(next)
  if (equalUndoSnapshot(beforeSnapshot, afterSnapshot)) return next
  return {
    ...next,
    history: {
      undoStack: [...prev.history.undoStack, beforeSnapshot],
      redoStack: [],
    },
  }
}

function createHost(initial: EditorState): AgentToolExecutorHost & { box: { state: EditorState } } {
  const box = { state: initial }
  return {
    box,
    getState: () => box.state,
    applyWithHistory: (fn) => {
      box.state = recordHistoryStep(box.state, fn(box.state))
    },
    applyWithoutHistory: (fn) => {
      box.state = fn(box.state)
    },
  }
}

describe('read tool executor', () => {
  it('rejects unknown argument keys', () => {
    assert.equal(validateUnknownKeys({ start: 0, extra: 1 }, ['start', 'end']), 'Unknown argument: extra')
    assert.equal(validateUnknownKeys({ start: 0 }, ['start', 'end']), null)
  })

  it('lists generation models through the injected fetch', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      local_models: [{
        pipeline: 'fast',
        spec: {
          display_name: 'LTX Fast',
          supported_resolutions_durations: { '1080p': { fps_to_durations: { '24': [4, 8] } } },
        },
      }],
      api_models: [],
    }), { status: 200 })
    const result = await listGenerationModels(fetchImpl)
    assert.equal(result.ok, true)
    assert.deepEqual(result.local, [{
      pipeline: 'fast',
      displayName: 'LTX Fast',
      resolutions: { '1080p': { '24': [4, 8] } },
    }])
  })
})

describe('edit tool executor', () => {
  it('splits the selected clip at the playhead and agent undo reverts it', async () => {
    const host = createHost(makeState({ selectedClipIds: ['c1'], playhead: 2 }))
    const executor = new AgentToolExecutor(host)
    const split = await executor.execute('split_clips', {})
    assert.equal(split.ok, true)
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 2)
    assert.ok(Array.isArray(split.createdClipIds) && split.createdClipIds.length === 1)

    const undone = await executor.execute('undo', {})
    assert.equal(undone.ok, true)
    assert.equal(undone.undone, 'split_clips')
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 1)
    assert.equal(selectActiveTimeline(host.getState())?.clips[0]?.id, 'c1')
  })

  it('refuses agent undo after a user edit', async () => {
    const host = createHost(makeState({ selectedClipIds: ['c1'] }))
    const executor = new AgentToolExecutor(host)
    const split = await executor.execute('split_clips', { time: 2 })
    assert.equal(split.ok, true)

    host.applyWithHistory(prev => editorActions.moveClips(prev, { clipIds: ['c1'], deltaTime: 1 }))
    const undone = await executor.execute('undo', {})
    assert.equal(undone.ok, false)
    assert.match(String(undone.error), /not an assistant edit/)
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 2)
  })

  it('inserts an asset and returns the new clip ids', async () => {
    const host = createHost(makeState({ clips: [] }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('insert_assets', { assetIds: ['asset-1'], startTime: 0, trackIndex: 0 })
    assert.equal(result.ok, true)
    assert.ok(Array.isArray(result.insertedClipIds) && (result.insertedClipIds as string[]).length >= 1)
    assert.ok((selectActiveTimeline(host.getState())?.clips.length ?? 0) >= 1)
  })

  it('refuses insert onto a locked track', async () => {
    const host = createHost(makeState({ clips: [], lockTrack0: true }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('insert_assets', { assetIds: ['asset-1'], trackIndex: 0 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Track is locked')
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 0)
  })

  it('errors on missing asset and clip ids without mutating', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const missingAsset = await executor.execute('insert_assets', { assetIds: ['nope'] })
    assert.equal(missingAsset.ok, false)
    assert.match(String(missingAsset.error), /Asset not found/)
    const missingClip = await executor.execute('delete_clips', { clipIds: ['missing'] })
    assert.equal(missingClip.ok, false)
    assert.match(String(missingClip.error), /Clip not found/)
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 1)
  })

  it('requires confirmation to delete many clips', async () => {
    const host = createHost(makeState({
      clips: [
        clip({ id: 'c1', startTime: 0, duration: 2, trackIndex: 0 }),
        clip({ id: 'c2', startTime: 3, duration: 2, trackIndex: 0 }),
      ],
    }))
    const executor = new AgentToolExecutor(host)
    const blocked = await executor.execute('delete_clips', { clipIds: ['c1', 'c2'] })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.needsConfirm, true)
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 2)

    const deleted = await executor.execute('delete_clips', { clipIds: ['c1', 'c2'], confirmed: true })
    assert.equal(deleted.ok, true)
    assert.deepEqual(deleted.deletedClipIds, ['c1', 'c2'])
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 0)
  })

  it('trims, moves, and deletes a single clip without confirm', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const trimmed = await executor.execute('trim_clip', { id: 'c1', start: 1, duration: 2 })
    assert.equal(trimmed.ok, true)
    const afterTrim = selectActiveTimeline(host.getState())?.clips.find(item => item.id === 'c1')
    assert.equal(afterTrim?.startTime, 1)
    assert.equal(afterTrim?.duration, 2)

    const moved = await executor.execute('move_clips', { clipIds: ['c1'], start: 3 })
    assert.equal(moved.ok, true)
    assert.equal(selectActiveTimeline(host.getState())?.clips.find(item => item.id === 'c1')?.startTime, 3)

    const deleted = await executor.execute('delete_clips', { clipIds: ['c1'] })
    assert.equal(deleted.ok, true)
    assert.equal(selectActiveTimeline(host.getState())?.clips.length, 0)
  })

  it('adds text and a subtitle, then selects and sets the playhead', async () => {
    const host = createHost(makeState({ clips: [] }))
    const executor = new AgentToolExecutor(host)
    const text = await executor.execute('add_text', { text: 'HELLO', startTime: 0, trackIndex: 0, duration: 3 })
    assert.equal(text.ok, true)
    const textClip = selectActiveTimeline(host.getState())?.clips.find(item => item.type === 'text')
    assert.ok(textClip)
    assert.equal(textClip.textStyle?.text, 'HELLO')
    assert.equal(textClip.duration, 3)

    const subtitle = await executor.execute('add_subtitle', { text: 'Hi', startTime: 0, endTime: 2 })
    assert.equal(subtitle.ok, true)
    assert.equal(selectActiveTimeline(host.getState())?.subtitles.length, 1)

    const selected = await executor.execute('select_clips', { clipIds: [textClip.id] })
    assert.equal(selected.ok, true)
    assert.deepEqual(selected.selectedClipIds, [textClip.id])

    const playhead = await executor.execute('set_playhead', { time: 1.5 })
    assert.equal(playhead.ok, true)
    assert.equal(playhead.playhead, 1.5)
  })

  it('creates and renames bins and assigns assets', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const created = await executor.execute('create_bin', { name: 'B-roll' })
    assert.equal(created.ok, true)
    const binId = String(created.binId)
    const assigned = await executor.execute('assign_assets_to_bin', { assetIds: ['asset-1'], binId })
    assert.equal(assigned.ok, true)
    assert.equal(host.getState().editorModel.assets.find(asset => asset.id === 'asset-1')?.binId, binId)
    const renamed = await executor.execute('rename_bin', { binId, name: 'B-roll 2' })
    assert.equal(renamed.ok, true)
    assert.equal(host.getState().editorModel.bins[binId], 'B-roll 2')
  })

  it('creates a timeline and still answers read tools', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const created = await executor.execute('create_timeline', { name: 'Alt' })
    assert.equal(created.ok, true)
    assert.equal(host.getState().editorModel.activeTimelineId, (created.timeline as { id: string }).id)
    const overview = await executor.execute('get_project_overview', {})
    assert.equal(overview.ok, true)
    assert.equal(overview.binCount, 0)
    assert.ok(Array.isArray(overview.timelines) && (overview.timelines as unknown[]).length === 2)
  })
})
