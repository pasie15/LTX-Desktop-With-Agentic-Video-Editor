import type { Asset } from '../../../types/project-model.ts'
import type { EditorState, TimelineGapSelection } from '../editor-state.ts'
import {
  detectImportedMediaType,
  type ImportedMediaType,
} from '../import-local-media.ts'
import {
  asNumber,
  asString,
  asStringArray,
  toolErrorResult,
  validateUnknownKeys,
} from './agent-tool-utils.ts'
import { IMPORT_TOOL_ALLOWED_KEYS, type AgentImportToolName } from './tool-definitions.ts'

const IMPORT_DESTINATIONS = ['assets', 'playhead', 'gap', 'after_last'] as const
export type AgentImportDestination = (typeof IMPORT_DESTINATIONS)[number]

export interface AgentImportJobs {
  importPath: (input: {
    srcPath: string
    type?: ImportedMediaType
    displayName?: string
  }) => Promise<Asset | null>
}

export interface AgentImportActionHost {
  getState: () => EditorState
  applyWithHistory: (fn: (state: EditorState) => EditorState) => void
  actions: {
    addAssetToEditor: (state: EditorState, asset: Asset) => EditorState
    insertAssetsToTimeline: (state: EditorState, params: {
      assets: Asset[]
      trackIndex?: number
      startTime?: number
    }) => EditorState
    assignAssetsToBin: (state: EditorState, assetIds: string[], binId?: string) => EditorState
  }
  importMedia?: AgentImportJobs
  getSelectedGap?: () => TimelineGapSelection | null
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

function parseDestination(value: unknown, fallback: AgentImportDestination): AgentImportDestination {
  if (typeof value === 'string' && (IMPORT_DESTINATIONS as readonly string[]).includes(value)) {
    return value as AgentImportDestination
  }
  return fallback
}

function resolveGap(
  state: EditorState,
  args: Record<string, unknown>,
  getSelectedGap?: () => TimelineGapSelection | null,
): TimelineGapSelection | null {
  const trackIndex = asNumber(args.trackIndex)
  const start = asNumber(args.start)
  const end = asNumber(args.end)
  if (trackIndex != null && start != null && end != null && end > start) {
    return { trackIndex, startTime: start, endTime: end }
  }
  return getSelectedGap?.() ?? state.session.selection.gap
}

function collectPaths(args: Record<string, unknown>): string[] {
  const many = asStringArray(args.paths)
  if (many && many.length > 0) return many
  const one = asString(args.path)
  return one ? [one] : []
}

function leafName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function defaultTrackIndex(state: EditorState, assets: Asset[], explicit: number | null): number {
  if (explicit != null) return explicit
  const allAudio = assets.length > 0 && assets.every(asset => asset.type === 'audio')
  if (!allAudio) return 0
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  const audioIndex = timeline?.tracks.findIndex(track => track.kind === 'audio' && !track.locked) ?? -1
  return audioIndex >= 0 ? audioIndex : 0
}

function trackLocked(state: EditorState, trackIndex: number): boolean {
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  return Boolean(timeline?.tracks[trackIndex]?.locked)
}

export async function executeImportTool(
  host: AgentImportActionHost,
  name: AgentImportToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const unknown = validateUnknownKeys(args, IMPORT_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  if (name !== 'import_media') return errorResult(`Unknown tool: ${name}`)
  if (!host.importMedia) return errorResult('Media import is not available')

  const paths = collectPaths(args)
  if (paths.length === 0) return errorResult('Missing path or paths')

  const explicitType = detectImportedMediaType({ type: asString(args.type) ?? undefined })
  if (asString(args.type) && !explicitType) {
    return errorResult('type must be image, video, or audio')
  }

  const destination = parseDestination(args.destination, 'assets')
  const gap = destination === 'gap' ? resolveGap(host.getState(), args, host.getSelectedGap) : null
  if (destination === 'gap' && !gap) {
    return errorResult('No selected gap. Select a gap or pass trackIndex, start, and end.')
  }

  const binId = asString(args.binId)
  if (args.binId != null && !binId) return errorResult('binId must be a non-empty string')
  if (binId && !host.getState().editorModel.bins[binId]) return errorResult('Bin not found')

  const imported: Asset[] = []
  const errors: Array<{ path: string; error: string }> = []
  for (const srcPath of paths) {
    const type = explicitType ?? detectImportedMediaType({ path: srcPath })
    if (!type) {
      errors.push({ path: srcPath, error: 'Unsupported media type. Use an image, video, or audio file.' })
      continue
    }
    const asset = await host.importMedia.importPath({
      srcPath,
      type,
      displayName: leafName(srcPath),
    })
    if (!asset) {
      errors.push({ path: srcPath, error: 'Failed to copy the file into the project' })
      continue
    }
    imported.push(asset)
  }

  if (imported.length === 0) {
    return {
      ok: false,
      error: errors[0]?.error ?? 'Failed to import media',
      errors,
    }
  }

  const state = host.getState()
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  const trackIndex = defaultTrackIndex(
    state,
    imported,
    asNumber(args.trackIndex) ?? (destination === 'gap' ? gap?.trackIndex ?? null : null),
  )
  if (destination !== 'assets') {
    if (!timeline) return errorResult('No active timeline')
    if (trackLocked(state, trackIndex)) return errorResult('Track is locked')
  }

  const startTime = destination === 'playhead'
    ? asNumber(args.startTime) ?? state.session.transport.currentTime
    : destination === 'gap' && gap
      ? gap.startTime
      : asNumber(args.startTime)

  const beforeIds = new Set(timeline?.clips.map(clip => clip.id) ?? [])
  host.applyWithHistory(prev => {
    let current = prev
    for (const asset of imported) {
      current = host.actions.addAssetToEditor(current, asset)
      if (binId) current = host.actions.assignAssetsToBin(current, [asset.id], binId)
      if (destination === 'assets') continue
      current = host.actions.insertAssetsToTimeline(current, {
        assets: [asset],
        trackIndex,
        ...(startTime != null ? { startTime } : {}),
      })
    }
    return current
  })

  const next = host.getState()
  const inserted = (next.editorModel.timelines.find(item => item.id === next.editorModel.activeTimelineId)?.clips ?? [])
    .filter(clip => !beforeIds.has(clip.id))
    .map(clip => ({
      id: clip.id,
      assetId: clip.assetId,
      start: clip.startTime,
      duration: clip.duration,
      track: clip.trackIndex,
    }))

  return {
    ok: true,
    destination,
    placed: destination !== 'assets',
    imported: imported.map(asset => ({
      assetId: asset.id,
      type: asset.type,
      name: asset.prompt,
      duration: asset.duration,
      path: asset.path,
    })),
    assetIds: imported.map(asset => asset.id),
    insertedClipIds: inserted.map(item => item.id),
    inserted,
    ...(errors.length > 0 ? { errors } : {}),
  }
}
