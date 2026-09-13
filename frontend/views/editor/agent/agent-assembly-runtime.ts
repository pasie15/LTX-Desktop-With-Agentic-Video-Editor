import type { EditorState } from '../editor-state.ts'
import {
  assemblyConfirmQuestions,
  buildAssemblyProposal,
  isAssemblyProceedChoice,
  MAX_ASSEMBLY_GENERATE_JOBS,
  normalizeAssemblyShots,
  type AgentAssemblyProposal,
  type AgentAssemblyShot,
} from './agent-assembly.ts'
import {
  executeGenerateTool,
  waitForHostGenerationSlot,
  type AgentGenerateActionHost,
  type AgentGenerateDestination,
} from './agent-generate-runtime.ts'
import { asBoolean, toolErrorResult, validateUnknownKeys } from './agent-tool-utils.ts'
import { ASSEMBLY_TOOL_ALLOWED_KEYS, type AgentAssemblyToolName } from './tool-definitions.ts'

export interface AgentAssemblyActionHost extends AgentGenerateActionHost {
  actions: AgentGenerateActionHost['actions'] & {
    addTextClip: (state: EditorState, params: {
      style?: { text?: string }
      startTime?: number
      trackIndex?: number
    }) => EditorState
  }
}

export interface AgentAssemblyMemory {
  getProposal: () => AgentAssemblyProposal | null
  setProposal: (proposal: AgentAssemblyProposal | null) => void
  getConfirmedMore: () => boolean
  setConfirmedMore: (value: boolean) => void
}

export interface AgentAssemblyShotResult {
  id: string
  title?: string
  status: 'placed' | 'failed' | 'cancelled' | 'pending'
  assetId?: string
  clipId?: string
  start?: number
  duration?: number
  titleClipId?: string
  error?: string
}

function errorResult(message: string): Record<string, unknown> {
  return toolErrorResult(message)
}

function needsConfirmResult(proposal: AgentAssemblyProposal, message: string): Record<string, unknown> {
  return {
    ok: false,
    needsConfirm: true,
    proposal,
    error: message,
  }
}

function trackLocked(state: EditorState, trackIndex: number): boolean {
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  return Boolean(timeline?.tracks[trackIndex]?.locked)
}

function trackEnd(state: EditorState, trackIndex: number): number {
  const timeline = state.editorModel.timelines.find(item => item.id === state.editorModel.activeTimelineId)
    ?? state.editorModel.timelines[0]
  if (!timeline) return 0
  return timeline.clips
    .filter(clip => clip.trackIndex === trackIndex)
    .reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0)
}

function resolveStart(
  state: EditorState,
  proposal: AgentAssemblyProposal,
  destination: AgentGenerateDestination,
): number {
  if (proposal.startTime != null) return proposal.startTime
  if (destination === 'after_last') return trackEnd(state, proposal.trackIndex)
  return state.session.transport.currentTime
}

function resolveProposal(
  args: Record<string, unknown>,
  memory: AgentAssemblyMemory,
): { ok: true; proposal: AgentAssemblyProposal } | { ok: false; error: Record<string, unknown> } {
  const fromArgs = args.shots !== undefined
    ? normalizeAssemblyShots(args.shots)
    : typeof args.script === 'string'
      ? normalizeAssemblyShots(args.script)
      : null
  if (fromArgs && fromArgs.length > 0) {
    const proposal = buildAssemblyProposal({
      kind: args.kind,
      destination: args.destination,
      trackIndex: args.trackIndex,
      startTime: args.startTime,
      model: args.model,
      resolution: args.resolution,
      audio: args.audio,
      skipStills: args.skipStills,
      shots: fromArgs,
    })
    memory.setProposal(proposal)
    return { ok: true, proposal }
  }
  const remembered = memory.getProposal()
  if (remembered && remembered.shots.length > 0) {
    return { ok: true, proposal: remembered }
  }
  return { ok: false, error: errorResult('Missing script or shots') }
}

export function rememberAssemblyAcceptance(
  memory: AgentAssemblyMemory,
  answers: Record<string, string | string[]>,
): void {
  const current = memory.getProposal()
  const shotsRaw = answers.shots
  if (typeof shotsRaw === 'string') {
    const parsed = normalizeAssemblyShots(shotsRaw)
    if (parsed && parsed.length > 0) {
      memory.setProposal(buildAssemblyProposal({
        ...(current ?? {}),
        shots: parsed,
        kind: current?.kind,
        destination: current?.destination,
        trackIndex: current?.trackIndex,
        startTime: current?.startTime,
        model: current?.model,
        resolution: current?.resolution,
        audio: current?.audio,
        skipStills: current?.skipStills,
      }))
    }
  }
  memory.setConfirmedMore(isAssemblyProceedChoice(answers.shot_list))
}

export async function executeAssemblyTool(
  host: AgentAssemblyActionHost,
  name: AgentAssemblyToolName,
  args: Record<string, unknown>,
  memory: AgentAssemblyMemory,
): Promise<Record<string, unknown>> {
  const unknown = validateUnknownKeys(args, ASSEMBLY_TOOL_ALLOWED_KEYS[name])
  if (unknown) return errorResult(unknown)
  if (name !== 'assemble_shots') return errorResult(`Unknown tool: ${name}`)

  const resolved = resolveProposal(args, memory)
  if (!resolved.ok) return resolved.error
  const proposal = resolved.proposal
  if (proposal.shots.length === 0) return errorResult('Shot list is empty')

  if (!asBoolean(args.confirmed)) {
    return needsConfirmResult(
      proposal,
      proposal.exceedsJobCap
        ? `Assembly needs confirmation, including proceeding past ${MAX_ASSEMBLY_GENERATE_JOBS} generate jobs.`
        : 'Assembly needs confirmation. Accept or edit the shot list, then retry with confirmed=true.',
    )
  }

  const confirmedMore = asBoolean(args.confirmedMore) || memory.getConfirmedMore()
  if (proposal.exceedsJobCap && !confirmedMore) {
    return needsConfirmResult(
      proposal,
      `This assembly is ${proposal.jobCount} generate jobs. Confirm proceeding past ${MAX_ASSEMBLY_GENERATE_JOBS}, then retry with confirmed=true and confirmedMore=true.`,
    )
  }

  if (proposal.jobCount > 0) {
    if (!host.generation) return errorResult('Generation is not available')
    const waited = await waitForHostGenerationSlot(host, 'assemble_shots')
    if (waited) return waited
  }

  const state = host.getState()
  if (proposal.destination !== 'assets' && trackLocked(state, proposal.trackIndex)) {
    return errorResult('Track is locked')
  }

  const checklist: AgentAssemblyShotResult[] = proposal.shots.map(shot => ({
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'pending',
  }))

  let cursor = resolveStart(state, proposal, proposal.destination)
  const placed: AgentAssemblyShotResult[] = []

  for (const [index, shot] of proposal.shots.entries()) {
    if (host.getAbortSignal?.()?.aborted) {
      checklist[index] = { ...checklist[index]!, status: 'cancelled', error: 'cancelled' }
      return {
        ok: false,
        error: 'Assembly cancelled',
        cancelled: true,
        completed: placed,
        failedAt: shot.id,
        checklist,
      }
    }

    const total = proposal.shots.length
    host.onProgress?.({
      toolName: 'assemble_shots',
      percent: Math.round((index / total) * 100),
      status: shot.assetId
        ? `${index + 1}/${total} placing…`
        : `${index + 1}/${total} generating…`,
    })

    const result = await generateAndPlaceShot(host, proposal, shot, cursor, index === 0)
    checklist[index] = result
    if (result.status !== 'placed') {
      return {
        ok: false,
        error: result.error ?? 'Assembly stopped',
        completed: placed,
        failedAt: shot.id,
        checklist,
      }
    }
    placed.push(result)
    if (result.start != null && result.duration != null) {
      cursor = result.start + result.duration
    }
  }

  host.onProgress?.({
    toolName: 'assemble_shots',
    percent: 100,
    status: `${proposal.shots.length}/${proposal.shots.length} placed`,
  })
  memory.setConfirmedMore(false)
  return {
    ok: true,
    kind: proposal.kind,
    destination: proposal.destination,
    jobCount: proposal.jobCount,
    placed,
    checklist,
  }
}

async function generateAndPlaceShot(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  shot: AgentAssemblyShot,
  startTime: number,
  isFirst: boolean,
): Promise<AgentAssemblyShotResult> {
  if (shot.assetId) {
    return placeExistingShot(host, proposal, shot, startTime)
  }

  const destination = isFirst && proposal.destination === 'gap' ? 'gap' : 'playhead'
  let imageAssetId = shot.imageAssetId
  const wantStill = !proposal.skipStills && !shot.skipStill && !imageAssetId

  if (wantStill) {
    const still = await executeGenerateTool(host, 'generate_image', {
      prompt: shot.prompt,
      destination: 'assets',
      confirmed: true,
    })
    if (still.ok === false) {
      return {
        id: shot.id,
        ...(shot.title ? { title: shot.title } : {}),
        status: String(still.error) === 'Generation cancelled' ? 'cancelled' : 'failed',
        error: String(still.error ?? 'Image generation failed'),
      }
    }
    if (typeof still.assetId === 'string') imageAssetId = still.assetId
  }

  const video = await executeGenerateTool(host, 'generate_video', {
    prompt: shot.prompt,
    model: proposal.model,
    duration: Math.max(shot.duration, 5),
    resolution: proposal.resolution,
    audio: proposal.audio,
    ...(imageAssetId ? { imageAssetId } : {}),
    destination,
    trackIndex: proposal.trackIndex,
    startTime,
    confirmed: true,
  })
  if (video.ok === false) {
    return {
      id: shot.id,
      ...(shot.title ? { title: shot.title } : {}),
      status: String(video.error) === 'Generation cancelled' ? 'cancelled' : 'failed',
      error: String(video.error ?? 'Video generation failed'),
    }
  }

  const inserted = Array.isArray(video.inserted)
    ? video.inserted as Array<{ id?: string; start?: number; duration?: number }>
    : []
  const clip = inserted[0]
  const clipId = typeof clip?.id === 'string'
    ? clip.id
    : Array.isArray(video.insertedClipIds) && typeof video.insertedClipIds[0] === 'string'
      ? video.insertedClipIds[0]
      : undefined
  const placedStart = typeof clip?.start === 'number' ? clip.start : startTime
  const placedDuration = typeof clip?.duration === 'number' ? clip.duration : shot.duration
  let titleClipId: string | undefined

  if (shot.title) {
    const beforeIds = new Set(
      (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
        ?? host.getState().editorModel.timelines[0])?.clips.map(item => item.id) ?? [],
    )
    host.applyWithHistory(prev => host.actions.addTextClip(prev, {
      style: { text: shot.title },
      startTime: placedStart,
      trackIndex: proposal.trackIndex,
    }))
    const created = (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
      ?? host.getState().editorModel.timelines[0])?.clips.find(item => !beforeIds.has(item.id))
    titleClipId = created?.id
  }

  return {
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'placed',
    assetId: typeof video.assetId === 'string' ? video.assetId : undefined,
    clipId,
    start: placedStart,
    duration: placedDuration,
    ...(titleClipId ? { titleClipId } : {}),
  }
}

function placeExistingShot(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  shot: AgentAssemblyShot,
  startTime: number,
): AgentAssemblyShotResult {
  const asset = host.getState().editorModel.assets.find(item => item.id === shot.assetId)
  if (!asset) {
    return {
      id: shot.id,
      ...(shot.title ? { title: shot.title } : {}),
      status: 'failed',
      error: `Asset not found: ${shot.assetId}`,
    }
  }

  const beforeIds = new Set(
    (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
      ?? host.getState().editorModel.timelines[0])?.clips.map(item => item.id) ?? [],
  )

  if (proposal.destination !== 'assets') {
    host.applyWithHistory(prev => host.actions.insertAssetsToTimeline(prev, {
      assets: [asset],
      trackIndex: proposal.trackIndex,
      startTime,
    }))
  }

  const inserted = (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    ?? host.getState().editorModel.timelines[0])?.clips.find(item => !beforeIds.has(item.id))
  const placedStart = inserted?.startTime ?? startTime
  const placedDuration = inserted?.duration ?? asset.duration ?? shot.duration
  let titleClipId: string | undefined

  if (shot.title) {
    const titleBefore = new Set(
      (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
        ?? host.getState().editorModel.timelines[0])?.clips.map(item => item.id) ?? [],
    )
    host.applyWithHistory(prev => host.actions.addTextClip(prev, {
      style: { text: shot.title },
      startTime: placedStart,
      trackIndex: proposal.trackIndex,
    }))
    titleClipId = (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
      ?? host.getState().editorModel.timelines[0])?.clips.find(item => !titleBefore.has(item.id))?.id
  }

  return {
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'placed',
    assetId: asset.id,
    clipId: inserted?.id,
    start: placedStart,
    duration: placedDuration,
    ...(titleClipId ? { titleClipId } : {}),
  }
}

export function assemblyConfirmQuestionsFromResult(result: Record<string, unknown>): ReturnType<typeof assemblyConfirmQuestions> | null {
  const proposal = result.proposal
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null
  const item = proposal as Record<string, unknown>
  if (item.tool !== 'assemble_shots' || !Array.isArray(item.shots)) return null
  const shots = normalizeAssemblyShots(item.shots)
  if (!shots) return null
  return assemblyConfirmQuestions(buildAssemblyProposal({
    ...item,
    shots,
  }))
}
