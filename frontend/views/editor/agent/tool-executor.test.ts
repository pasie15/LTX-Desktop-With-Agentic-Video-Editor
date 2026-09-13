import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDefaultTimeline, DEFAULT_COLOR_CORRECTION, DEFAULT_TRACKS, type Asset, type Timeline, type TimelineClip } from '../../../types/project-model.ts'
import { DEFAULT_LAYOUT } from '../editor-layout.ts'
import type { EditorState, EditorUndoSnapshot } from '../editor-state.ts'
import type { AgentGenerationJobs } from './agent-generate-runtime.ts'
import type { AgentImportJobs } from './agent-import-runtime.ts'
import { createMemoryRefStore } from './agent-refs.ts'
import { AgentToolExecutor, type AgentEditorActions, type AgentToolExecutorHost } from './agent-edit-runtime.ts'
import { listGenerationModels, validateUnknownKeys } from './agent-tool-utils.ts'

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

function audioAsset(id: string, duration = 12): Asset {
  return {
    id,
    type: 'audio',
    path: `/tmp/${id}.mp3`,
    prompt: id,
    resolution: 'imported',
    duration,
    createdAt: 1,
  }
}

function imageAsset(id: string): Asset {
  return {
    id,
    type: 'image',
    path: `/tmp/${id}.png`,
    prompt: id,
    resolution: '1080p',
    duration: 5,
    createdAt: 1,
  }
}

function clip(partial: Pick<TimelineClip, 'id' | 'startTime' | 'duration' | 'trackIndex'> & { assetId?: string; type?: TimelineClip['type'] }): TimelineClip {
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

function snapshot(state: EditorState): EditorUndoSnapshot {
  return {
    assets: state.editorModel.assets,
    bins: state.editorModel.bins,
    timelines: state.editorModel.timelines,
  }
}

function sameSnapshot(left: EditorUndoSnapshot, right: EditorUndoSnapshot): boolean {
  return left.assets === right.assets && left.bins === right.bins && left.timelines === right.timelines
}

function replaceActiveTimeline(state: EditorState, update: (timeline: Timeline) => Timeline): EditorState {
  const activeId = state.editorModel.activeTimelineId
  return {
    ...state,
    editorModel: {
      ...state.editorModel,
      timelines: state.editorModel.timelines.map(timeline => (
        timeline.id === activeId ? update(timeline) : timeline
      )),
    },
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
  return {
    editorModel: {
      assets: overrides?.assets ?? [videoAsset('asset-1'), videoAsset('asset-2', 3)],
      bins: overrides?.bins ?? {},
      timelines: [timeline],
      activeTimelineId: 'tl1',
    },
    session: {
      selection: {
        clipIds: new Set(overrides?.selectedClipIds ?? []),
        subtitleId: null,
        editingSubtitleId: null,
        gap: null,
      },
      transport: {
        currentTime: overrides?.playhead ?? 2,
        isPlaying: false,
        shuttleSpeed: 0,
        playingInOut: false,
        timelineInOutMap: {},
      },
      tools: {
        zoom: 1,
        snapEnabled: true,
        activeTool: 'select',
        lastTrimTool: 'ripple',
      },
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
      regeneration: {
        regeneratingAssetId: null,
        regeneratingClipId: null,
        preError: null,
      },
      clipboard: {
        kind: null,
        clips: [],
        copiedFromTimelineId: null,
      },
    },
    history: {
      undoStack: [],
      redoStack: [],
    },
    projectSync: {
      dirty: false,
    },
  }
}

function recordHistoryStep(prev: EditorState, next: EditorState): EditorState {
  if (next === prev) return prev
  const beforeSnapshot = snapshot(prev)
  const afterSnapshot = snapshot(next)
  if (sameSnapshot(beforeSnapshot, afterSnapshot)) return next
  return {
    ...next,
    history: {
      undoStack: [...prev.history.undoStack, beforeSnapshot],
      redoStack: [],
    },
  }
}

function fakeActions(): AgentEditorActions {
  return {
    insertAssetsToTimeline: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: [
        ...timeline.clips,
        ...params.assets.map((asset, index) => clip({
          id: `ins-${asset.id}-${index}`,
          assetId: asset.id,
          startTime: (params.startTime ?? 0) + index,
          duration: asset.duration ?? 4,
          trackIndex: params.trackIndex ?? 0,
          type: asset.type === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video',
        })),
      ],
    })),
    overwriteAssetsOnTimeline: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: [
        ...timeline.clips,
        ...params.assets.map((asset, index) => clip({
          id: `ow-${asset.id}-${index}`,
          assetId: asset.id,
          startTime: params.startTime ?? 0,
          duration: asset.duration ?? 4,
          trackIndex: params.trackIndex ?? 0,
        })),
      ],
    })),
    splitClipsAtTime: (state, clipIds, time) => replaceActiveTimeline(state, timeline => {
      const extras: TimelineClip[] = []
      const clips = timeline.clips.map(item => {
        if (!clipIds.includes(item.id)) return item
        const splitPoint = time - item.startTime
        if (splitPoint <= 0.1 || splitPoint >= item.duration - 0.1) return item
        extras.push(clip({
          id: `${item.id}-b`,
          assetId: item.assetId ?? 'asset-1',
          startTime: time,
          duration: item.duration - splitPoint,
          trackIndex: item.trackIndex,
        }))
        return { ...item, duration: splitPoint }
      })
      return { ...timeline, clips: [...clips, ...extras] }
    }),
    moveClips: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: timeline.clips.map(item => (
        params.clipIds.includes(item.id)
          ? {
              ...item,
              startTime: Math.max(0, item.startTime + (params.deltaTime ?? 0)),
              trackIndex: params.targetTrackIndex ?? item.trackIndex,
            }
          : item
      )),
    })),
    resizeClip: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: timeline.clips.map(item => {
        if (item.id !== params.clipId) return item
        if (params.edge === 'start') {
          const nextStart = Math.max(0, item.startTime + params.deltaTime)
          return { ...item, startTime: nextStart, duration: Math.max(0.1, item.duration - (nextStart - item.startTime)) }
        }
        return { ...item, duration: Math.max(0.1, item.duration + params.deltaTime) }
      }),
    })),
    deleteClips: (state, clipIds) => {
      const deleteSet = new Set(clipIds)
      const next = replaceActiveTimeline(state, timeline => ({
        ...timeline,
        clips: timeline.clips.filter(item => !deleteSet.has(item.id)),
      }))
      return {
        ...next,
        session: {
          ...next.session,
          selection: {
            ...next.session.selection,
            clipIds: new Set([...next.session.selection.clipIds].filter(id => !deleteSet.has(id))),
          },
        },
      }
    },
    addTextClip: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: [
        ...timeline.clips,
        {
          ...clip({
            id: `text-${timeline.clips.filter(item => item.type === 'text').length + 1}`,
            startTime: params.startTime ?? state.session.transport.currentTime,
            duration: 5,
            trackIndex: params.trackIndex ?? 0,
          }),
          type: 'text',
          assetId: null,
          textStyle: {
            text: params.style?.text ?? 'Title Text',
            fontFamily: 'Inter',
            fontSize: 64,
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#fff',
            backgroundColor: 'transparent',
            textAlign: 'center',
            positionX: 50,
            positionY: 50,
            strokeColor: 'transparent',
            strokeWidth: 0,
            shadowColor: '#000',
            shadowBlur: 0,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
            letterSpacing: 0,
            lineHeight: 1,
            maxWidth: 80,
            padding: 0,
            borderRadius: 0,
            opacity: 100,
          },
        },
      ],
    })),
    addSubtitleTrack: (state) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      tracks: [
        { id: 'track-sub', name: 'Subtitles', muted: false, locked: false, kind: 'video', type: 'subtitle' },
        ...timeline.tracks,
      ],
    })),
    addSubtitle: (state, params) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      subtitles: [
        ...timeline.subtitles,
        {
          id: 'sub-1',
          text: params.text || 'New subtitle',
          startTime: params.startTime ?? state.session.transport.currentTime,
          endTime: params.endTime ?? state.session.transport.currentTime + 3,
          trackIndex: params.trackIndex,
        },
      ],
    })),
    setSelectedClipIds: (state, value) => ({
      ...state,
      session: {
        ...state.session,
        selection: { ...state.session.selection, clipIds: value, subtitleId: null },
      },
    }),
    setCurrentTime: (state, time) => ({
      ...state,
      session: {
        ...state.session,
        transport: { ...state.session.transport, currentTime: Math.max(0, time) },
      },
    }),
    createTimeline: (state, name) => {
      const created = createDefaultTimeline(name ?? 'Timeline 2')
      created.id = 'tl-new'
      return {
        ...state,
        editorModel: {
          ...state.editorModel,
          timelines: [...state.editorModel.timelines, created],
          activeTimelineId: created.id,
        },
      }
    },
    createBin: (state, binId, name) => ({
      ...state,
      editorModel: {
        ...state.editorModel,
        bins: { ...state.editorModel.bins, [binId]: name },
      },
    }),
    assignAssetsToBin: (state, assetIds, binId) => ({
      ...state,
      editorModel: {
        ...state.editorModel,
        assets: state.editorModel.assets.map(asset => (
          assetIds.includes(asset.id) ? { ...asset, binId } : asset
        )),
      },
    }),
    renameBin: (state, binId, newName) => ({
      ...state,
      editorModel: {
        ...state.editorModel,
        bins: { ...state.editorModel.bins, [binId]: newName },
      },
    }),
    addAssetToEditor: (state, asset) => ({
      ...state,
      editorModel: {
        ...state.editorModel,
        assets: [asset, ...state.editorModel.assets],
      },
    }),
    insertGeneratedGapAsset: (state, params) => {
      const withAsset = {
        ...state,
        editorModel: {
          ...state.editorModel,
          assets: [params.asset, ...state.editorModel.assets],
        },
      }
      return replaceActiveTimeline(withAsset, timeline => ({
        ...timeline,
        clips: [
          ...timeline.clips,
          clip({
            id: `gap-${params.asset.id}`,
            assetId: params.asset.id,
            startTime: params.gap.startTime,
            duration: params.gap.endTime - params.gap.startTime,
            trackIndex: params.gap.trackIndex,
          }),
        ],
      }))
    },
    setClipAudioLevel: (state, clipId, volume) => replaceActiveTimeline(state, timeline => ({
      ...timeline,
      clips: timeline.clips.map(item => (
        item.id === clipId ? { ...item, volume: Math.max(0, Math.min(1, volume)), muted: false } : item
      )),
    })),
    applyGeneratedTake: (state, assetId, take) => ({
      ...state,
      editorModel: {
        ...state.editorModel,
        assets: state.editorModel.assets.map(asset => (
          asset.id === assetId
            ? {
                ...asset,
                path: take.path,
                takes: [...(asset.takes ?? []), take],
                activeTakeIndex: (asset.takes ?? []).length,
              }
            : asset
        )),
      },
    }),
    undo: (state) => {
      const previous = state.history.undoStack[state.history.undoStack.length - 1]
      if (!previous) return state
      return {
        ...state,
        editorModel: {
          ...state.editorModel,
          assets: previous.assets,
          bins: previous.bins,
          timelines: previous.timelines,
        },
        history: {
          undoStack: state.history.undoStack.slice(0, -1),
          redoStack: [...state.history.redoStack, snapshot(state)],
        },
      }
    },
  }
}

function fakeJobs(overrides?: Partial<AgentGenerationJobs>): AgentGenerationJobs {
  return {
    isBusy: () => false,
    runImage: async () => ({ status: 'complete', path: '/tmp/still.png' }),
    runVideo: async () => ({ status: 'complete', path: '/tmp/cut.mp4' }),
    enhancePrompt: async prompt => ({ ok: true, prompt: `enhanced: ${prompt}` }),
    cancel: () => {},
    persistVisualAsset: async (srcPath, type) => ({
      path: `/project/${type}-${srcPath.split('/').pop()}`,
      bigThumbnailPath: '/project/big.jpg',
      smallThumbnailPath: '/project/small.jpg',
      width: 1280,
      height: 720,
    }),
    ...overrides,
  }
}

function fakeImport(overrides?: Partial<AgentImportJobs>): AgentImportJobs {
  return {
    importPath: async ({ srcPath, type, displayName }) => ({
      id: `imported-${srcPath.split(/[\\/]/).pop()}`,
      type: type ?? 'video',
      path: `/project/${srcPath.split(/[\\/]/).pop()}`,
      prompt: `Imported: ${displayName ?? srcPath}`,
      resolution: 'imported',
      duration: type === 'image' ? 5 : 8,
      createdAt: 1,
    }),
    ...overrides,
  }
}

function createHost(
  initial: EditorState,
  extras?: {
    generation?: AgentGenerationJobs
    importMedia?: AgentImportJobs
    speech?: AgentToolExecutorHost['speech']
    refs?: AgentToolExecutorHost['refs']
    selectedGap?: { trackIndex: number; startTime: number; endTime: number } | null
    approveAll?: boolean
  },
): AgentToolExecutorHost & { box: { state: EditorState } } {
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
    actions: fakeActions(),
    generation: extras?.generation,
    importMedia: extras?.importMedia,
    speech: extras?.speech,
    refs: extras?.refs,
    getSelectedGap: extras?.selectedGap !== undefined ? () => extras.selectedGap ?? null : undefined,
    getApproveAll: () => extras?.approveAll === true,
  }
}

function activeClips(state: EditorState): TimelineClip[] {
  return state.editorModel.timelines.find(timeline => timeline.id === state.editorModel.activeTimelineId)?.clips ?? []
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
    assert.equal(activeClips(host.getState()).length, 2)
    assert.ok(Array.isArray(split.createdClipIds) && split.createdClipIds.length === 1)

    const undone = await executor.execute('undo', {})
    assert.equal(undone.ok, true)
    assert.equal(undone.undone, 'split_clips')
    assert.equal(activeClips(host.getState()).length, 1)
    assert.equal(activeClips(host.getState())[0]?.id, 'c1')
  })

  it('refuses agent undo after a user edit', async () => {
    const host = createHost(makeState({ selectedClipIds: ['c1'] }))
    const executor = new AgentToolExecutor(host)
    const split = await executor.execute('split_clips', { time: 2 })
    assert.equal(split.ok, true)

    host.applyWithHistory(prev => host.actions.moveClips(prev, { clipIds: ['c1'], deltaTime: 1 }))
    const undone = await executor.execute('undo', {})
    assert.equal(undone.ok, false)
    assert.match(String(undone.error), /not an assistant edit/)
    assert.equal(activeClips(host.getState()).length, 2)
  })

  it('inserts an asset and returns the new clip ids', async () => {
    const host = createHost(makeState({ clips: [] }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('insert_assets', { assetIds: ['asset-1'], startTime: 0, trackIndex: 0 })
    assert.equal(result.ok, true)
    assert.ok(Array.isArray(result.insertedClipIds) && (result.insertedClipIds as string[]).length >= 1)
    assert.ok(activeClips(host.getState()).length >= 1)
  })

  it('places audio on the first unlocked audio track when trackIndex is omitted', async () => {
    const host = createHost(makeState({
      clips: [],
      assets: [audioAsset('theme')],
    }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('insert_assets', { assetIds: ['theme'], startTime: 0 })
    assert.equal(result.ok, true)
    const placed = activeClips(host.getState())[0]
    assert.equal(placed?.trackIndex, 3)
    assert.equal(placed?.assetId, 'theme')
  })

  it('refuses insert onto a locked track', async () => {
    const host = createHost(makeState({ clips: [], lockTrack0: true }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('insert_assets', { assetIds: ['asset-1'], trackIndex: 0 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Track is locked')
    assert.equal(activeClips(host.getState()).length, 0)
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
    assert.equal(activeClips(host.getState()).length, 1)
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
    assert.equal(activeClips(host.getState()).length, 2)

    const deleted = await executor.execute('delete_clips', { clipIds: ['c1', 'c2'], confirmed: true })
    assert.equal(deleted.ok, true)
    assert.deepEqual(deleted.deletedClipIds, ['c1', 'c2'])
    assert.equal(activeClips(host.getState()).length, 0)
  })

  it('trims, moves, and deletes a single clip without confirm', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const trimmed = await executor.execute('trim_clip', { id: 'c1', start: 1, duration: 2 })
    assert.equal(trimmed.ok, true)
    const afterTrim = activeClips(host.getState()).find(item => item.id === 'c1')
    assert.equal(afterTrim?.startTime, 1)
    assert.equal(afterTrim?.duration, 2)

    const moved = await executor.execute('move_clips', { clipIds: ['c1'], start: 3 })
    assert.equal(moved.ok, true)
    assert.equal(activeClips(host.getState()).find(item => item.id === 'c1')?.startTime, 3)

    const deleted = await executor.execute('delete_clips', { clipIds: ['c1'] })
    assert.equal(deleted.ok, true)
    assert.equal(activeClips(host.getState()).length, 0)
  })

  it('adds text and a subtitle, then selects and sets the playhead', async () => {
    const host = createHost(makeState({ clips: [] }))
    const executor = new AgentToolExecutor(host)
    const text = await executor.execute('add_text', { text: 'HELLO', startTime: 0, trackIndex: 0, duration: 3 })
    assert.equal(text.ok, true)
    const textClip = activeClips(host.getState()).find(item => item.type === 'text')
    assert.ok(textClip)
    assert.equal(textClip.textStyle?.text, 'HELLO')
    assert.equal(textClip.duration, 3)

    const subtitle = await executor.execute('add_subtitle', { text: 'Hi', startTime: 0, endTime: 2 })
    assert.equal(subtitle.ok, true)
    const timeline = host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    assert.equal(timeline?.subtitles.length, 1)

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

  it('creates a timeline', async () => {
    const host = createHost(makeState())
    const executor = new AgentToolExecutor(host)
    const created = await executor.execute('create_timeline', { name: 'Alt' })
    assert.equal(created.ok, true)
    assert.equal(host.getState().editorModel.activeTimelineId, (created.timeline as { id: string }).id)
    assert.equal(host.getState().editorModel.timelines.length, 2)
  })
})

describe('generate tool executor', () => {
  it('refuses generate without confirm and does not start a job', async () => {
    const jobs = fakeJobs({
      runVideo: async () => {
        throw new Error('should not run')
      },
    })
    const host = createHost(makeState({ clips: [] }), { generation: jobs })
    const executor = new AgentToolExecutor(host)
    const blocked = await executor.execute('generate_video', {
      prompt: 'a 4s cutaway of rain on a window',
      duration: 4,
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.needsConfirm, true)
    assert.equal(host.getState().editorModel.assets.length, 2)
  })

  it('generates a video and places it in the selected gap after confirm', async () => {
    const host = createHost(makeState({ clips: [] }), {
      generation: fakeJobs(),
      selectedGap: { trackIndex: 0, startTime: 1, endTime: 5 },
    })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('fill_gap', {
      prompt: 'rain on a window, slow push in',
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.destination, 'gap')
    assert.ok(typeof result.assetId === 'string')
    assert.ok(Array.isArray(result.insertedClipIds) && result.insertedClipIds.length === 1)
    const placed = activeClips(host.getState())[0]
    assert.equal(placed?.startTime, 1)
    assert.equal(placed?.duration, 4)
    assert.ok(host.getState().editorModel.assets.some(asset => asset.id === result.assetId))
  })

    it('waits for a busy slot then generates', async () => {
    let busy = true
    const progress: string[] = []
    const host = createHost(makeState({ clips: [] }), {
      generation: fakeJobs({ isBusy: () => busy }),
    })
    host.onProgress = item => { progress.push(item.status) }
    const executor = new AgentToolExecutor(host)
    const pending = executor.execute('generate_image', {
      prompt: 'a red apple on a table',
      confirmed: true,
    })
    setTimeout(() => { busy = false }, 25)
    const result = await pending
    assert.equal(result.ok, true)
    assert.ok(host.getState().editorModel.assets.some(asset => asset.id === result.assetId))
    assert.ok(progress.some(status => /Waiting for generation slot/i.test(status)))
  })

  it('cancels generate while waiting for the slot', async () => {
    const controller = new AbortController()
    const host = createHost(makeState({ clips: [] }), {
      generation: fakeJobs({ isBusy: () => true }),
    })
    host.getAbortSignal = () => controller.signal
    const executor = new AgentToolExecutor(host)
    const pending = executor.execute('generate_image', {
      prompt: 'a red apple on a table',
      confirmed: true,
    })
    setTimeout(() => controller.abort(), 20)
    const result = await pending
    assert.equal(result.ok, false)
    assert.match(String(result.error), /cancel/i)
    assert.equal(host.getState().editorModel.assets.length, 2)
  })

  it('adds a confirmed still to assets only', async () => {
    const host = createHost(makeState({ clips: [] }), { generation: fakeJobs() })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('generate_image', {
      prompt: 'a red apple on a table, soft window light',
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.destination, 'assets')
    assert.equal(result.placed, false)
    assert.equal(activeClips(host.getState()).length, 0)
    assert.ok(host.getState().editorModel.assets.some(asset => asset.id === result.assetId))
  })

  it('enhances a prompt without mutating the timeline', async () => {
    const host = createHost(makeState(), { generation: fakeJobs() })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('enhance_prompt', { prompt: 'rain', mediaType: 'video' })
    assert.equal(result.ok, true)
    assert.equal(result.prompt, 'enhanced: rain')
    assert.equal(activeClips(host.getState()).length, 1)
  })

  it('regenerates a clip take from generationParams', async () => {
    const asset = videoAsset('asset-1')
    asset.generationParams = {
      mode: 'text-to-video',
      prompt: 'rain on a window',
      model: 'fast',
      duration: 4,
      resolution: '540p',
      fps: 24,
      audio: false,
      cameraMotion: 'none',
    }
    const host = createHost(makeState({
      assets: [asset],
      selectedClipIds: ['c1'],
    }), { generation: fakeJobs() })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('regenerate_clip', { confirmed: true })
    assert.equal(result.ok, true)
    const updated = host.getState().editorModel.assets.find(item => item.id === 'asset-1')
    assert.ok(updated?.takes && updated.takes.length >= 1)
    assert.match(updated.path, /cut\.mp4/)
  })
})

describe('assembly tool executor', () => {
  it('proposes a shot list without starting generate jobs', async () => {
    let videoCalls = 0
    const host = createHost(makeState({ clips: [], playhead: 0 }), {
      generation: fakeJobs({
        runVideo: async () => {
          videoCalls += 1
          return { status: 'complete', path: '/tmp/cut.mp4' }
        },
      }),
    })
    const executor = new AgentToolExecutor(host)
    const blocked = await executor.execute('assemble_shots', {
      script: 'INT. KITCHEN - DAY\nA woman pours coffee.\n\nEXT. STREET - NIGHT\nRain on asphalt.',
      kind: 'script',
    })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.needsConfirm, true)
    const proposal = blocked.proposal as { shots: Array<{ title?: string; prompt: string }>; jobCount: number }
    assert.equal(proposal.shots.length, 2)
    assert.equal(proposal.shots[0]?.title, 'KITCHEN - DAY')
    assert.equal(proposal.jobCount, 4)
    assert.equal(videoCalls, 0)
    assert.equal(activeClips(host.getState()).length, 0)
  })

  it('assembles confirmed shots sequentially and adds titles', async () => {
    const progress: string[] = []
    const host = createHost(makeState({ clips: [], playhead: 0 }), { generation: fakeJobs(), approveAll: true })
    host.onProgress = item => { progress.push(item.status) }
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('assemble_shots', {
      shots: [
        { id: 's1', prompt: 'woman pours coffee, warm window light', duration: 4, title: 'KITCHEN' },
        { id: 's2', prompt: 'rain on asphalt, slow push in', duration: 4, title: 'STREET' },
      ],
      skipStills: true,
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.jobCount, 2)
    const clips = activeClips(host.getState())
    const videos = clips.filter(item => item.type === 'video')
    const titles = clips.filter(item => item.type === 'text')
    assert.equal(videos.length, 2)
    assert.equal(titles.length, 2)
    assert.equal(videos[0]?.startTime, 0)
    assert.equal(videos[1]?.startTime, 5)
    assert.ok(progress.some(status => status.includes('1/2 generating')))
  })

  it('waits for a busy slot then assembles every shot', async () => {
    let busy = true
    const progress: string[] = []
    const host = createHost(makeState({ clips: [], playhead: 0 }), {
      generation: fakeJobs({ isBusy: () => busy }),
      approveAll: true,
    })
    host.onProgress = item => { progress.push(item.status) }
    const executor = new AgentToolExecutor(host)
    const pending = executor.execute('assemble_shots', {
      shots: [
        { id: 's1', prompt: 'paper boy on a bicycle, 1970s street', duration: 4 },
        { id: 's2', prompt: 'newspaper lands on a porch', duration: 4 },
      ],
      skipStills: true,
      confirmed: true,
    })
    setTimeout(() => { busy = false }, 25)
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal((result.placed as unknown[]).length, 2)
    assert.equal(activeClips(host.getState()).filter(item => item.type === 'video').length, 2)
    assert.ok(progress.some(status => /Waiting for generation slot/i.test(status)))
    assert.ok(!String(result.error ?? '').toLowerCase().includes('busy'))
  })

  it('requires confirmedMore when the assembly exceeds eight generate jobs', async () => {
    const host = createHost(makeState({ clips: [], playhead: 0 }), { generation: fakeJobs() })
    const executor = new AgentToolExecutor(host)
    const shots = Array.from({ length: 5 }, (_, index) => ({
      id: `s${index + 1}`,
      prompt: `shot ${index + 1} wide of a street`,
      duration: 4,
    }))
    const blocked = await executor.execute('assemble_shots', { shots, confirmed: true })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.needsConfirm, true)
    const proposal = blocked.proposal as { jobCount: number; exceedsJobCap: boolean }
    assert.equal(proposal.jobCount, 10)
    assert.equal(proposal.exceedsJobCap, true)
    assert.equal(activeClips(host.getState()).length, 0)

    host.getApproveAll = () => true
    const ran = await executor.execute('assemble_shots', { shots, confirmed: true, confirmedMore: true })
    assert.equal(ran.ok, true)
    assert.equal((ran.placed as unknown[]).length, 5)
  })

  it('stops the queue on a failed shot and keeps earlier placements', async () => {
    let videos = 0
    const host = createHost(makeState({ clips: [], playhead: 0 }), {
      generation: fakeJobs({
        runVideo: async () => {
          videos += 1
          if (videos === 2) return { status: 'error', error: 'GPU OOM' }
          return { status: 'complete', path: `/tmp/cut-${videos}.mp4` }
        },
      }),
      approveAll: true,
    })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('assemble_shots', {
      shots: [
        { id: 's1', prompt: 'first shot', duration: 4 },
        { id: 's2', prompt: 'second shot', duration: 4 },
      ],
      skipStills: true,
      confirmed: true,
    })
    assert.equal(result.ok, false)
    assert.match(String(result.error), /GPU OOM/)
    assert.equal(result.failedAt, 's2')
    assert.equal((result.completed as unknown[]).length, 1)
    assert.equal(activeClips(host.getState()).filter(item => item.type === 'video').length, 1)
  })

  it('places existing user assets from a shot list without generating', async () => {
    let videoCalls = 0
    const host = createHost(makeState({
      clips: [],
      playhead: 0,
      assets: [videoAsset('hero', 6), audioAsset('theme', 12)],
    }), {
      generation: fakeJobs({
        runVideo: async () => {
          videoCalls += 1
          return { status: 'complete', path: '/tmp/cut.mp4' }
        },
      }),
      approveAll: true,
    })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('assemble_shots', {
      shots: [
        { id: 's1', prompt: 'hero clip', duration: 6, assetId: 'hero' },
        { id: 's2', prompt: 'theme music', duration: 12, assetId: 'theme', title: 'SCORE' },
      ],
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.jobCount, 0)
    assert.equal(videoCalls, 0)
    const clips = activeClips(host.getState())
    assert.equal(clips.filter(item => item.assetId === 'hero' || item.assetId === 'theme').length, 2)
    assert.equal(clips.filter(item => item.type === 'text').length, 1)
  })

  it('reuses the last proposed shot list after accept', async () => {
    const host = createHost(makeState({ clips: [], playhead: 0 }), { generation: fakeJobs(), approveAll: true })
    const executor = new AgentToolExecutor(host)
    await executor.execute('assemble_shots', {
      script: '1. Hands pour coffee [4s]\n2. Street in rain [4s]',
      skipStills: true,
    })
    executor.rememberAssemblyAcceptance({ shot_list: 'Accept' })
    const result = await executor.execute('assemble_shots', { confirmed: true })
    assert.equal(result.ok, true)
    assert.equal((result.placed as unknown[]).length, 2)
  })
})

describe('import tool executor', () => {
  it('imports audio into the project and can place it', async () => {
    const host = createHost(makeState({ clips: [] }), { importMedia: fakeImport() })
    const executor = new AgentToolExecutor(host)
    const added = await executor.execute('import_media', { path: '/tmp/theme.mp3', type: 'audio' })
    assert.equal(added.ok, true)
    assert.equal(added.placed, false)
    assert.deepEqual(added.assetIds, ['imported-theme.mp3'])
    assert.ok(host.getState().editorModel.assets.some(asset => asset.id === 'imported-theme.mp3'))
    assert.equal(activeClips(host.getState()).length, 0)

    const placed = await executor.execute('import_media', {
      path: '/tmp/cut.mp4',
      type: 'video',
      destination: 'playhead',
      startTime: 2,
    })
    assert.equal(placed.ok, true)
    assert.equal(placed.placed, true)
    assert.ok(Array.isArray(placed.insertedClipIds) && (placed.insertedClipIds as string[]).length >= 1)
    assert.equal(activeClips(host.getState())[0]?.startTime, 2)
  })

  it('rejects unsupported files without mutating', async () => {
    const host = createHost(makeState({ clips: [] }), { importMedia: fakeImport() })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('import_media', { path: '/tmp/notes.txt' })
    assert.equal(result.ok, false)
    assert.match(String(result.error), /Unsupported/)
    assert.equal(host.getState().editorModel.assets.length, 2)
  })
})

describe('refs speech and mix', () => {
  it('registers a still and resolves it on assemble', async () => {
    const refs = createMemoryRefStore()
    const host = createHost(makeState({
      clips: [],
      playhead: 0,
      assets: [imageAsset('hero-still'), audioAsset('theme', 12)],
    }), {
      generation: fakeJobs(),
      refs,
      approveAll: true,
    })
    const executor = new AgentToolExecutor(host)
    const registered = await executor.execute('register_ref', {
      name: 'Paper boy',
      assetId: 'hero-still',
      role: 'character',
    })
    assert.equal(registered.ok, true)
    const listed = await executor.execute('list_refs', {})
    assert.equal((listed.refs as unknown[]).length, 1)

    let imageCalls = 0
    host.generation = fakeJobs({
      runImage: async input => {
        imageCalls += 1
        assert.equal(input.imagePath, '/tmp/hero-still.png')
        return { status: 'complete', path: '/tmp/still-from-ref.png' }
      },
    })
    const result = await executor.execute('assemble_shots', {
      shots: [{ id: 's1', prompt: 'the paper boy on a stoop', duration: 4, refId: (registered.ref as { id: string }).id }],
      skipStills: false,
      confirmed: true,
      openingTitle: 'Before Sunrise',
      musicAssetId: 'theme',
    })
    assert.equal(result.ok, true)
    assert.equal(imageCalls, 1)
    const clips = activeClips(host.getState())
    assert.ok(clips.some(item => item.type === 'text'))
    const music = clips.find(item => item.assetId === 'theme')
    assert.ok(music)
    assert.equal(music.trackIndex, 4)
    assert.equal(music.volume, 0.25)
  })

  it('generates speech onto A1', async () => {
    const host = createHost(makeState({ clips: [], playhead: 0 }), {
      importMedia: fakeImport(),
      speech: {
        synthesize: async () => ({ path: '/tmp/vo.mp3' }),
      },
    })
    const executor = new AgentToolExecutor(host)
    const blocked = await executor.execute('generate_speech', { text: 'The paper boy waits.' })
    assert.equal(blocked.ok, false)
    const result = await executor.execute('generate_speech', {
      text: 'The paper boy waits.',
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.placed, true)
    const clips = activeClips(host.getState())
    assert.equal(clips[0]?.trackIndex, 3)
    assert.equal(clips[0]?.type, 'audio')
  })

  it('sets clip volume for a basic mix', async () => {
    const host = createHost(makeState({
      clips: [clip({ id: 'music-1', startTime: 0, duration: 8, trackIndex: 4, assetId: 'theme', type: 'audio' })],
      assets: [audioAsset('theme', 8)],
    }))
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('set_clip_volume', { clipId: 'music-1', volume: 0.25 })
    assert.equal(result.ok, true)
    assert.equal(activeClips(host.getState()).find(item => item.id === 'music-1')?.volume, 0.25)
  })

  it('reviews a confirmed still when Approve all is off', async () => {
    const host = createHost(makeState({ clips: [] }), { generation: fakeJobs(), approveAll: false })
    const executor = new AgentToolExecutor(host)
    const result = await executor.execute('generate_image', {
      prompt: 'character sheet of the paper boy, turnaround',
      confirmed: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.needsReview, true)
    assert.equal(result.checkpoint, 'character_sheet')
    assert.ok(host.getState().editorModel.assets.some(asset => asset.id === result.assetId))
  })

  it('pauses assemble after each still unless Approve all is on', async () => {
    const host = createHost(makeState({ clips: [], playhead: 0 }), {
      generation: fakeJobs(),
      approveAll: false,
    })
    const executor = new AgentToolExecutor(host)
    const first = await executor.execute('assemble_shots', {
      shots: [
        { id: 's1', prompt: 'paper boy on a stoop, morning light', duration: 5 },
        { id: 's2', prompt: 'rides down the block', duration: 5 },
      ],
      confirmed: true,
    })
    assert.equal(first.ok, true)
    assert.equal(first.needsReview, true)
    assert.equal(first.checkpoint, 'still')
    assert.equal(activeClips(host.getState()).filter(item => item.type === 'video').length, 0)

    executor.rememberAssemblyAcceptance({ review: 'Approve' })
    const afterVideo = await executor.execute('assemble_shots', { confirmed: true })
    assert.equal(afterVideo.needsReview, true)
    assert.equal(afterVideo.checkpoint, 'next_shot')
    assert.equal(activeClips(host.getState()).filter(item => item.type === 'video').length, 1)

    executor.rememberAssemblyAcceptance({ review: 'Approve' })
    const secondStill = await executor.execute('assemble_shots', { confirmed: true })
    assert.equal(secondStill.checkpoint, 'still')

    executor.rememberAssemblyAcceptance({ review: 'Approve' })
    const done = await executor.execute('assemble_shots', { confirmed: true })
    assert.equal(done.ok, true)
    assert.equal(done.needsReview, undefined)
    assert.equal(activeClips(host.getState()).filter(item => item.type === 'video').length, 2)
  })
})

