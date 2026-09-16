import type { Asset, TextOverlayStyle } from '../../../types/project-model.ts'
import type { EditorState } from '../editor-state.ts'
import { applyNarrationSync, scaleShotsToCoverDuration } from './agent-cut.ts'
import { planFromAssembly, type AgentEditPlan } from './agent-plan.ts'
import {
  parseReviewPreview,
  reviewDecisionFromAnswers,
  type AgentReviewPreview,
} from './agent-approvals.ts'
import {
  assemblyConfirmQuestions,
  bindAssemblyUserMedia,
  buildAssemblyProposal,
  inferAssemblyMediaFromAssets,
  isAssemblyProceedChoice,
  MAX_ASSEMBLY_GENERATE_JOBS,
  normalizeAssemblyShots,
  preferredReferenceAssetId,
  shotImpliesOnCameraVoice,
  stillPromptForShot,
  videoPromptForShot,
  type AgentAssemblyPreferredMedia,
  type AgentAssemblyProposal,
  type AgentAssemblyShot,
  type AgentAssemblyStage,
  type AgentCharacterSheet,
} from './agent-assembly.ts'
import {
  executeGenerateTool,
  waitForHostGenerationSlot,
  type AgentGenerateActionHost,
  type AgentGenerateDestination,
} from './agent-generate-runtime.ts'
import {
  AGENT_MUSIC_MIX_LEVEL,
  AGENT_MUSIC_TRACK_INDEX,
  AGENT_OPENING_TITLE_DURATION_S,
  AGENT_TITLE_TRACK_INDEX,
  AGENT_VOICEOVER_MIX_LEVEL,
  AGENT_VOICEOVER_TRACK_INDEX,
  firstUnlockedTrackIndex,
} from './agent-mix.ts'
import {
  AGENT_SHOT_TITLE_DURATION_S,
  preferredTrackForTextRole,
  styleForTextRole,
  type AgentTextOverlay,
  type AgentTextRole,
} from './agent-text.ts'
import type { AgentRefStore } from './agent-refs.ts'
import {
  importSpeechAsset,
  placeAudioAsset,
  type AgentSpeechActionHost,
} from './agent-speech-runtime.ts'
import { applyShotLipSync, type AgentLipSyncActionHost } from './agent-lipsync-runtime.ts'
import { collectIdentityStillIds, firstIdentityStillId, isIdentityStillId } from './agent-identity.ts'
import { asBoolean, toolErrorResult, validateUnknownKeys } from './agent-tool-utils.ts'
import { ASSEMBLY_TOOL_ALLOWED_KEYS, type AgentAssemblyToolName } from './tool-definitions.ts'

export interface AgentAssemblyActionHost extends AgentGenerateActionHost, AgentSpeechActionHost, AgentLipSyncActionHost {
  actions: AgentGenerateActionHost['actions'] & AgentSpeechActionHost['actions'] & AgentLipSyncActionHost['actions'] & {
    addTextClip: (state: EditorState, params: {
      style?: Partial<TextOverlayStyle>
      startTime?: number
      trackIndex?: number
      duration?: number
    }) => EditorState
    resizeClip: (state: EditorState, params: { clipId: string; edge: 'start' | 'end'; deltaTime: number }) => EditorState
    setClipSpeed?: (state: EditorState, clipId: string, speed: number) => EditorState
  }
  refs?: AgentRefStore
  getPreferredAssemblyMedia?: () => AgentAssemblyPreferredMedia
}

export interface AgentAssemblyProgress {
  shotIndex: number
  stage: AgentAssemblyStage
  sheetIndex?: number
  lastStillId?: string
  cursor: number
  placed: AgentAssemblyShotResult[]
  checklist: AgentAssemblyShotResult[]
  voiceoverAssetId?: string
  characterSheetIds?: string[]
}

export interface AgentAssemblyMemory {
  getProposal: () => AgentAssemblyProposal | null
  setProposal: (proposal: AgentAssemblyProposal | null) => void
  getConfirmedMore: () => boolean
  setConfirmedMore: (value: boolean) => void
  getProgress: () => AgentAssemblyProgress | null
  setProgress: (progress: AgentAssemblyProgress | null) => void
  getReviewDecision: () => 'approve' | 'reject' | 'revise' | null
  setReviewDecision: (value: 'approve' | 'reject' | 'revise' | null) => void
  getPlan?: () => AgentEditPlan | null
  setPlan?: (plan: AgentEditPlan) => void
}

export interface AgentAssemblyShotResult {
  id: string
  title?: string
  status: 'placed' | 'failed' | 'cancelled' | 'pending'
  assetId?: string
  stillAssetId?: string
  clipId?: string
  start?: number
  duration?: number
  titleClipId?: string
  error?: string
  lipSyncProvider?: string
  lipSyncAssetId?: string
  lipSyncSkipped?: string
  lipSyncError?: string
  lipSyncFallbackReason?: string
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
    const plan = memory.getPlan?.()
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
      voiceover: args.voiceover,
      voiceoverAssetId: args.voiceoverAssetId,
      musicAssetId: args.musicAssetId,
      openingTitle: args.openingTitle,
      title: args.title,
      referenceAssetId: args.referenceAssetId,
      character: args.character ?? plan?.character,
      characterSheets: args.characterSheets ?? plan?.characterSheets,
      overlays: args.overlays,
      lyrics: args.lyrics,
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
        voiceover: current?.voiceover,
        voiceoverAssetId: current?.voiceoverAssetId,
        musicAssetId: current?.musicAssetId,
        openingTitle: current?.openingTitle,
        referenceAssetId: current?.referenceAssetId,
        character: current?.character,
        characterSheets: current?.characterSheets,
        overlays: current?.overlays,
      }))
    }
  }
  memory.setConfirmedMore(isAssemblyProceedChoice(answers.shot_list))
  memory.setReviewDecision(reviewDecisionFromAnswers(answers))
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
  const shouldBindUserMedia = args.shots !== undefined || args.script !== undefined || !memory.getProgress()
  let proposal = shouldBindUserMedia
    ? bindUserMediaIntoProposal(host, resolved.proposal)
    : resolved.proposal
  memory.setProposal(proposal)
  if (proposal.shots.length === 0) return errorResult('Shot list is empty')
  if (!memory.getPlan?.()) {
    memory.setPlan?.(planFromAssembly({
      goal: typeof args.script === 'string' ? args.script.slice(0, 160) : `Assemble ${proposal.kind}`,
      shots: proposal.shots,
      voiceover: proposal.voiceover,
      voiceoverAssetId: proposal.voiceoverAssetId,
      musicAssetId: proposal.musicAssetId,
      openingTitle: proposal.openingTitle,
      referenceAssetId: proposal.referenceAssetId,
      character: proposal.character,
      characterSheets: proposal.characterSheets,
    }))
  }

  const confirmed = asBoolean(args.confirmed) || host.getApproveAll?.() === true
  if (!confirmed) {
    return needsConfirmResult(
      proposal,
      proposal.exceedsJobCap
        ? `Assembly needs confirmation, including proceeding past ${MAX_ASSEMBLY_GENERATE_JOBS} generate jobs.`
        : 'Assembly needs confirmation. Accept or edit the shot list, then retry with confirmed=true.',
    )
  }

  const confirmedMore = asBoolean(args.confirmedMore) || memory.getConfirmedMore() || host.getApproveAll?.() === true
  if (proposal.exceedsJobCap && !confirmedMore) {
    return needsConfirmResult(
      proposal,
      `This assembly is ${proposal.jobCount} generate jobs. Confirm proceeding past ${MAX_ASSEMBLY_GENERATE_JOBS}, then retry with confirmed=true and confirmedMore=true.`,
    )
  }

  const decision = memory.getReviewDecision()
  if (decision === 'reject') {
    memory.setReviewDecision(null)
    memory.setProgress(null)
    return errorResult('User rejected this step. Assembly stopped.')
  }
  if (decision === 'revise') {
    memory.setReviewDecision(null)
    const progress = rewindAssemblyReview(memory)
    return {
      ok: false,
      error: 'User asked to revise this still or sheet. Follow their notes, then retry assemble_shots with confirmed=true.',
      needsRevise: true,
      progress,
    }
  }
  memory.setReviewDecision(null)

  if (proposal.jobCount > 0) {
    if (!host.generation) return errorResult('Generation is not available')
    const waited = await waitForHostGenerationSlot(host, 'assemble_shots')
    if (waited) return waited
  }

  const state = host.getState()
  if (proposal.destination !== 'assets' && trackLocked(state, proposal.trackIndex)) {
    return errorResult('Track is locked')
  }

  const stepByStep = host.getApproveAll?.() !== true
  const existing = memory.getProgress()
  const checklist: AgentAssemblyShotResult[] = existing?.checklist ?? proposal.shots.map(shot => ({
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'pending' as const,
  }))
  let cursor = existing?.cursor ?? resolveStart(state, proposal, proposal.destination)
  const placed: AgentAssemblyShotResult[] = existing?.placed.slice() ?? []
  let lastStillId = existing?.lastStillId
  let voiceoverAsset: Asset | undefined
  const characterSheets = proposal.characterSheets ?? []
  let characterSheetIds = existing?.characterSheetIds?.slice() ?? []
  let stage: AgentAssemblyStage = existing?.stage
    ?? (characterSheets.length > 0 ? 'character_sheet' : 'still')
  const startSheetIndex = existing?.stage === 'character_sheet' ? existing.sheetIndex ?? 0 : characterSheetIds.length
  const startStillIndex = existing?.stage === 'still' ? existing.shotIndex : 0
  const startVideoIndex = existing?.stage === 'video' ? existing.shotIndex : 0

  if (!existing) {
    if (proposal.voiceover && !proposal.voiceoverAssetId) {
      if (!host.speech) {
        return errorResult('ElevenLabs speech is not available. Add an ElevenLabs API key in Settings.')
      }
      host.onProgress?.({
        toolName: 'assemble_shots',
        percent: 0,
        status: 'Generating voiceover…',
      })
      const synthesized = await host.speech.synthesize({ text: proposal.voiceover })
      if ('error' in synthesized) return errorResult(synthesized.error)
      const imported = await importSpeechAsset(host, synthesized.path, proposal.voiceover.slice(0, 48) || 'Voiceover')
      if (!imported.ok) return imported.error
      voiceoverAsset = imported.asset
    } else if (proposal.voiceoverAssetId) {
      voiceoverAsset = host.getState().editorModel.assets.find(item => item.id === proposal.voiceoverAssetId)
      if (!voiceoverAsset) return errorResult(`Asset not found: ${proposal.voiceoverAssetId}`)
      if (voiceoverAsset.type !== 'audio') return errorResult('voiceoverAssetId must be an audio asset')
    }
  } else if (existing.voiceoverAssetId) {
    voiceoverAsset = host.getState().editorModel.assets.find(item => item.id === existing.voiceoverAssetId)
  }

  if (!existing && voiceoverAsset?.duration && voiceoverAsset.duration > 0) {
    const scaled = scaleShotsToCoverDuration(proposal.shots, voiceoverAsset.duration)
    proposal = { ...proposal, shots: scaled }
    memory.setProposal(proposal)
  }

  if (!existing) {
    placeAssemblyMusic(host, proposal, cursor)
  }

  const snapshotProgress = (next: {
    stage: AgentAssemblyStage
    shotIndex: number
    sheetIndex?: number
  }): AgentAssemblyProgress => ({
    shotIndex: next.shotIndex,
    stage: next.stage,
    ...(next.sheetIndex != null ? { sheetIndex: next.sheetIndex } : {}),
    lastStillId,
    cursor,
    placed,
    checklist,
    ...(voiceoverAsset ? { voiceoverAssetId: voiceoverAsset.id } : {}),
    ...(characterSheetIds.length > 0 ? { characterSheetIds } : {}),
  })

  if (stage === 'character_sheet' && characterSheets.length > 0) {
    for (let index = startSheetIndex; index < characterSheets.length; index += 1) {
      const sheet = characterSheets[index]!
      if (host.getAbortSignal?.()?.aborted) {
        return {
          ok: false,
          error: 'Assembly cancelled',
          cancelled: true,
          completed: placed,
          failedAt: sheet.id,
          checklist,
        }
      }
      reportAssemblyProgress(host, {
        percent: Math.round((index / Math.max(characterSheets.length + proposal.shots.length, 1)) * 20),
        status: `Character sheet ${index + 1}/${characterSheets.length}`,
      })
      const sheetResult = await withAssemblyProgress(
        host,
        `character sheet ${index + 1}/${characterSheets.length}`,
        8,
        () => generateCharacterSheet(host, proposal, sheet),
      )
      if (sheetResult.status !== 'ready') {
        return {
          ok: false,
          error: sheetResult.error ?? 'Character sheet failed',
          completed: placed,
          failedAt: sheet.id,
          checklist,
        }
      }
      characterSheetIds.push(sheetResult.stillAssetId)
      lastStillId = sheetResult.stillAssetId
      const moreSheets = index < characterSheets.length - 1
      if (stepByStep) {
        memory.setProgress(snapshotProgress({
          stage: moreSheets ? 'character_sheet' : 'still',
          shotIndex: 0,
          sheetIndex: index + 1,
        }))
        return reviewAssemblyStep(host, {
          checkpoint: 'character_sheet',
          shot: { id: sheet.id, prompt: sheet.prompt, duration: 0, title: sheet.look ?? 'Character sheet' },
          assetId: sheetResult.stillAssetId,
          nextStep: moreSheets ? 'the next character look' : 'scene start frames',
          placed,
          checklist,
          remaining: moreSheets
            ? characterSheets.length - index - 1
            : proposal.shots.length,
        })
      }
    }
    stage = 'still'
  }

  if (stage === 'still') {
    for (let index = startStillIndex; index < proposal.shots.length; index += 1) {
      const shot = proposal.shots[index]!
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
      const attachedStillId = resolveShotStillId(host, shot, proposal)
      const wantFirst = !shot.assetId && !proposal.skipStills && !shot.skipStill && !attachedStillId
      const wantLast = !shot.assetId
        && !proposal.skipStills
        && Boolean(shot.lastFramePrompt)
        && !shot.lastImageAssetId
        && Boolean(attachedStillId)
      reportAssemblyProgress(host, {
        percent: 20 + Math.round((index / proposal.shots.length) * 40),
        status: wantFirst
          ? `Start frame ${index + 1}/${proposal.shots.length}`
          : wantLast
            ? `Last frame ${index + 1}/${proposal.shots.length}`
            : `${index + 1}/${proposal.shots.length} preparing…`,
      })
      if (wantFirst) {
        const stillResult = await withAssemblyProgress(
          host,
          `${index + 1}/${proposal.shots.length} start frame`,
          20 + Math.round((index / proposal.shots.length) * 40),
          () => generateShotStill(host, proposal, shot),
        )
        if (stillResult.status !== 'ready') {
          checklist[index] = {
            ...checklist[index]!,
            status: stillResult.status,
            error: stillResult.error,
          }
          return {
            ok: false,
            error: stillResult.error ?? 'Assembly stopped',
            completed: placed,
            failedAt: shot.id,
            checklist,
          }
        }
        lastStillId = stillResult.stillAssetId
        proposal.shots[index] = { ...shot, imageAssetId: stillResult.stillAssetId }
        checklist[index] = {
          ...checklist[index]!,
          stillAssetId: stillResult.stillAssetId,
          status: 'pending',
        }
        memory.setProposal(proposal)
        const needsLast = Boolean(shot.lastFramePrompt)
        const moreStills = needsLast || proposal.shots.slice(index + 1).some(item => (
          !item.assetId && !proposal.skipStills && !item.skipStill && !item.imageAssetId
        ))
        if (!stepByStep && needsLast) {
          const lastStill = await generateShotStill(host, proposal, proposal.shots[index]!, 'last')
          if (lastStill.status === 'ready') {
            proposal.shots[index] = { ...proposal.shots[index]!, lastImageAssetId: lastStill.stillAssetId }
            memory.setProposal(proposal)
          }
        }
        if (stepByStep) {
          memory.setProgress(snapshotProgress({
            stage: moreStills || needsLast ? 'still' : 'video',
            shotIndex: needsLast ? index : (moreStills ? index + 1 : 0),
            sheetIndex: characterSheets.length,
          }))
          return reviewAssemblyStep(host, {
            checkpoint: 'still',
            shot,
            assetId: stillResult.stillAssetId,
            nextStep: needsLast ? 'the last-frame still' : moreStills ? 'the next start frame' : 'video',
            placed,
            checklist,
            remaining: moreStills ? proposal.shots.length - index : proposal.shots.length,
          })
        }
      } else if (wantLast) {
        const lastStill = await withAssemblyProgress(
          host,
          `${index + 1}/${proposal.shots.length} last frame`,
          20 + Math.round((index / proposal.shots.length) * 40),
          () => generateShotStill(host, proposal, shot, 'last'),
        )
        if (lastStill.status !== 'ready') {
          return {
            ok: false,
            error: lastStill.error ?? 'Last-frame still failed',
            completed: placed,
            failedAt: shot.id,
            checklist,
          }
        }
        proposal.shots[index] = { ...shot, lastImageAssetId: lastStill.stillAssetId }
        memory.setProposal(proposal)
        const moreStills = proposal.shots.slice(index + 1).some(item => (
          !item.assetId && !proposal.skipStills && !item.skipStill && !item.imageAssetId
        ))
        if (stepByStep) {
          memory.setProgress(snapshotProgress({
            stage: moreStills ? 'still' : 'video',
            shotIndex: moreStills ? index + 1 : 0,
            sheetIndex: characterSheets.length,
          }))
          return reviewAssemblyStep(host, {
            checkpoint: 'last_frame',
            shot,
            assetId: lastStill.stillAssetId,
            nextStep: moreStills ? 'the next start frame' : 'video',
            placed,
            checklist,
            remaining: moreStills ? proposal.shots.length - index - 1 : proposal.shots.length,
          })
        }
      } else if (attachedStillId) {
        checklist[index] = { ...checklist[index]!, stillAssetId: attachedStillId, status: 'pending' }
        lastStillId = attachedStillId
      }
    }
    stage = 'video'
  }

  for (let index = startVideoIndex; index < proposal.shots.length; index += 1) {
    const shot = proposal.shots[index]!
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
    const attachedStillId = resolveShotStillId(host, shot, proposal)
      ?? checklist[index]?.stillAssetId
    reportAssemblyProgress(host, {
      percent: 60 + Math.round((index / total) * 40),
      status: shot.assetId
        ? `${index + 1}/${total} placing…`
        : `${index + 1}/${total} video…`,
    })

    const result = await withAssemblyProgress(
      host,
      `${index + 1}/${total} video`,
      60 + Math.round((index / total) * 40),
      () => generateAndPlaceShot(
        host,
        proposal,
        shot,
        cursor,
        index === 0,
        lastStillId,
        attachedStillId,
      ),
    )
    checklist[index] = result
    if (result.status === 'placed' && result.stillAssetId) lastStillId = result.stillAssetId
    if (result.status !== 'placed') {
      memory.setProgress(null)
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

    if (stepByStep && index < proposal.shots.length - 1) {
      memory.setProgress(snapshotProgress({
        stage: 'video',
        shotIndex: index + 1,
        sheetIndex: characterSheets.length,
      }))
      return reviewAssemblyStep(host, {
        checkpoint: 'video',
        shot,
        assetId: result.assetId ?? result.stillAssetId,
        nextStep: 'the next video',
        placed,
        checklist,
        remaining: total - index - 1,
      })
    }
  }

  const mix = placeAssemblyMix(host, proposal, placed, voiceoverAsset)
  const timing = voiceoverAsset
    ? applyNarrationSync(host)
    : null

  host.onProgress?.({
    toolName: 'assemble_shots',
    percent: 100,
    status: `${proposal.shots.length}/${proposal.shots.length} placed`,
  })
  memory.setConfirmedMore(false)
  memory.setProgress(null)
  return {
    ok: true,
    kind: proposal.kind,
    destination: proposal.destination,
    jobCount: proposal.jobCount,
    placed,
    checklist,
    ...mix,
    ...(timing ? {
      cut: timing.cut,
      synced: timing.synced,
      syncActions: timing.actions,
      needsGenerate: timing.needsGenerate,
      shortfall: timing.shortfall,
    } : {}),
  }
}

function bindUserMediaIntoProposal(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
): AgentAssemblyProposal {
  const usedShotAssetIds = new Set(
    proposal.shots.flatMap(shot => [shot.assetId].filter((id): id is string => Boolean(id))),
  )
  const inferred = inferAssemblyMediaFromAssets(
    host.getState().editorModel.assets.filter(asset => (
      asset.id !== proposal.voiceoverAssetId && !usedShotAssetIds.has(asset.id)
    )),
  )
  const preferred = host.getPreferredAssemblyMedia?.() ?? {}
  const musicAssetId = preferred.musicAssetId ?? inferred.musicAssetId
  const referenceAssetId = preferredReferenceAssetId(preferred) ?? inferred.referenceAssetId
  return bindAssemblyUserMedia(proposal, {
    ...(referenceAssetId && !usedShotAssetIds.has(referenceAssetId)
      ? { referenceAssetId }
      : {}),
    ...(musicAssetId && musicAssetId !== proposal.voiceoverAssetId && !usedShotAssetIds.has(musicAssetId)
      ? { musicAssetId }
      : {}),
  }, host.getState().editorModel.assets)
}

function reportAssemblyProgress(
  host: AgentAssemblyActionHost,
  progress: { percent: number; status: string },
): void {
  host.onProgress?.({
    toolName: 'assemble_shots',
    percent: progress.percent,
    status: progress.status,
  })
}

async function withAssemblyProgress<T>(
  host: AgentAssemblyActionHost,
  label: string,
  percent: number,
  run: () => Promise<T>,
): Promise<T> {
  const previous = host.onProgress
  host.onProgress = item => {
    previous?.({
      toolName: 'assemble_shots',
      percent: item.percent || percent,
      status: item.toolName === 'assemble_shots' ? item.status : `${label} — ${item.status}`,
    })
  }
  try {
    return await run()
  } finally {
    host.onProgress = previous
  }
}

function musicAlreadyPlaced(host: AgentAssemblyActionHost, assetId: string): boolean {
  const timeline = host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    ?? host.getState().editorModel.timelines[0]
  return Boolean(timeline?.clips.some(clip => clip.assetId === assetId))
}

function placeAssemblyMusic(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  startTime: number,
): void {
  if (!proposal.musicAssetId || musicAlreadyPlaced(host, proposal.musicAssetId)) return
  const music = host.getState().editorModel.assets.find(item => item.id === proposal.musicAssetId)
  if (!music || music.type !== 'audio') return
  const timeline = host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    ?? host.getState().editorModel.timelines[0]
  placeAudioAsset(host, music, {
    trackIndex: firstUnlockedTrackIndex(timeline?.tracks, 'audio', AGENT_MUSIC_TRACK_INDEX),
    startTime,
    volume: AGENT_MUSIC_MIX_LEVEL,
  })
}

function resolveShotStillId(
  host: AgentAssemblyActionHost,
  shot: AgentAssemblyShot,
  proposal: AgentAssemblyProposal,
): string | undefined {
  const identityIds = collectIdentityStillIds({
    referenceAssetId: proposal.referenceAssetId,
    preferred: host.getPreferredAssemblyMedia?.(),
    refs: host.refs?.list(),
    assets: host.getState().editorModel.assets,
  })
  if (isIdentityStillId(shot.imageAssetId, identityIds)) return undefined
  return shot.imageAssetId
}

function resolveShotIdentity(
  host: AgentAssemblyActionHost,
  shot: AgentAssemblyShot,
  proposal: AgentAssemblyProposal,
): string | undefined {
  if (shot.showProtagonist === false) return undefined
  if (shot.refId) return host.refs?.resolveImageAssetId(shot.refId) ?? proposal.referenceAssetId
  if (proposal.referenceAssetId) return proposal.referenceAssetId
  const preferred = host.getPreferredAssemblyMedia?.()
  return preferredReferenceAssetId(preferred ?? {})
    ?? firstIdentityStillId(collectIdentityStillIds({
      preferred,
      refs: host.refs?.list(),
      assets: host.getState().editorModel.assets,
    }))
}

function addStyledTextClip(
  host: AgentAssemblyActionHost,
  input: {
    text: string
    role: AgentTextRole
    startTime: number
    duration: number
    trackIndex: number
    style?: Partial<TextOverlayStyle>
  },
): string | undefined {
  const beforeIds = new Set(
    (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
      ?? host.getState().editorModel.timelines[0])?.clips.map(item => item.id) ?? [],
  )
  host.applyWithHistory(prev => {
    let current = host.actions.addTextClip(prev, {
      style: styleForTextRole(input.role, input.text, input.style),
      startTime: input.startTime,
      trackIndex: input.trackIndex,
    })
    const created = (current.editorModel.timelines.find(item => item.id === current.editorModel.activeTimelineId)
      ?? current.editorModel.timelines[0])?.clips.find(item => !beforeIds.has(item.id))
    if (created && input.duration !== created.duration) {
      current = host.actions.resizeClip(current, {
        clipId: created.id,
        edge: 'end',
        deltaTime: input.duration - created.duration,
      })
    }
    return current
  })
  return (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    ?? host.getState().editorModel.timelines[0])?.clips.find(item => !beforeIds.has(item.id))?.id
}

function placeAssemblyMix(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  placed: AgentAssemblyShotResult[],
  voiceoverAsset?: Asset,
): Record<string, unknown> {
  const pictureStart = placed.reduce((min, shot) => (
    shot.start != null ? Math.min(min, shot.start) : min
  ), Number.POSITIVE_INFINITY)
  const pictureEnd = placed.reduce((max, shot) => (
    shot.start != null && shot.duration != null ? Math.max(max, shot.start + shot.duration) : max
  ), 0)
  const start = Number.isFinite(pictureStart) ? pictureStart : 0
  const timeline = host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
    ?? host.getState().editorModel.timelines[0]
  const extras: Record<string, unknown> = {}

  const titleTrack = firstUnlockedTrackIndex(timeline?.tracks, 'video', AGENT_TITLE_TRACK_INDEX)
  if (proposal.openingTitle) {
    extras.openingTitleClipId = addStyledTextClip(host, {
      text: proposal.openingTitle,
      role: 'title',
      startTime: start,
      duration: AGENT_OPENING_TITLE_DURATION_S,
      trackIndex: titleTrack,
    })
  }

  extras.overlayClipIds = placeAssemblyOverlays(host, proposal, placed, start, timeline?.tracks)

  if (voiceoverAsset) {
    const placedVo = placeAudioAsset(host, voiceoverAsset, {
      trackIndex: firstUnlockedTrackIndex(timeline?.tracks, 'audio', AGENT_VOICEOVER_TRACK_INDEX),
      startTime: start,
      volume: AGENT_VOICEOVER_MIX_LEVEL,
    })
    extras.voiceoverClipId = placedVo.clipId
    extras.voiceoverAssetId = voiceoverAsset.id
  }

  if (proposal.musicAssetId && !musicAlreadyPlaced(host, proposal.musicAssetId)) {
    const music = host.getState().editorModel.assets.find(item => item.id === proposal.musicAssetId)
    if (music && music.type === 'audio') {
      const placedMusic = placeAudioAsset(host, music, {
        trackIndex: firstUnlockedTrackIndex(timeline?.tracks, 'audio', AGENT_MUSIC_TRACK_INDEX),
        startTime: start,
        volume: AGENT_MUSIC_MIX_LEVEL,
      })
      extras.musicClipId = placedMusic.clipId
      extras.musicAssetId = music.id
      extras.musicVolume = AGENT_MUSIC_MIX_LEVEL
    }
  }

  extras.pictureStart = start
  extras.pictureEnd = pictureEnd
  return extras
}

function placeAssemblyOverlays(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  placed: AgentAssemblyShotResult[],
  pictureStart: number,
  tracks: Array<{ kind?: string; locked?: boolean }> | undefined,
): string[] {
  const ids: string[] = []
  const overlays = assemblyOverlays(proposal, placed)
  for (const overlay of overlays) {
    const id = addStyledTextClip(host, {
      text: overlay.text,
      role: overlay.role,
      startTime: pictureStart + overlay.startTime,
      duration: overlay.duration,
      trackIndex: firstUnlockedTrackIndex(tracks, 'video', preferredTrackForTextRole(overlay.role)),
      style: overlay.style,
    })
    if (id) ids.push(id)
  }
  return ids
}

function assemblyOverlays(
  proposal: AgentAssemblyProposal,
  placed: AgentAssemblyShotResult[],
): AgentTextOverlay[] {
  if (proposal.overlays && proposal.overlays.length > 0) return proposal.overlays
  if (proposal.kind !== 'music_video') return []
  const lyrics: AgentTextOverlay[] = []
  for (const [index, shot] of proposal.shots.entries()) {
    if (!shot.dialogue) continue
    const placedShot = placed[index]
    lyrics.push({
      text: shot.dialogue,
      role: 'lyrics',
      startTime: Math.max(0, (placedShot?.start ?? 0) - (placed[0]?.start ?? 0)),
      duration: placedShot?.duration ?? shot.duration,
      style: {},
    })
  }
  return lyrics
}

function rewindAssemblyReview(memory: AgentAssemblyMemory): AgentAssemblyProgress | null {
  const progress = memory.getProgress()
  const proposal = memory.getProposal()
  if (!progress) return null
  if (progress.stage === 'character_sheet') {
    const sheetIndex = Math.max(0, (progress.sheetIndex ?? 1) - 1)
    const characterSheetIds = progress.characterSheetIds?.slice(0, sheetIndex) ?? []
    const next = { ...progress, sheetIndex, characterSheetIds }
    memory.setProgress(next)
    return next
  }
  if (progress.stage === 'still') {
    const shotIndex = Math.max(0, progress.shotIndex - 1)
    if (proposal?.shots[shotIndex]) {
      const shot = proposal.shots[shotIndex]!
      proposal.shots[shotIndex] = { ...shot }
      delete proposal.shots[shotIndex]!.imageAssetId
      delete proposal.shots[shotIndex]!.lastImageAssetId
      memory.setProposal(proposal)
    }
    const checklist = progress.checklist.slice()
    if (checklist[shotIndex]) {
      checklist[shotIndex] = { ...checklist[shotIndex]!, status: 'pending' }
      delete checklist[shotIndex]!.stillAssetId
    }
    const next = { ...progress, shotIndex, checklist }
    memory.setProgress(next)
    return next
  }
  if (progress.stage === 'video' && progress.shotIndex === 0 && proposal) {
    const lastStillIndex = [...proposal.shots].map((shot, index) => (
      !shot.assetId && !proposal.skipStills && !shot.skipStill ? index : -1
    )).filter(index => index >= 0).at(-1)
    if (lastStillIndex != null) {
      const shot = proposal.shots[lastStillIndex]!
      proposal.shots[lastStillIndex] = { ...shot }
      delete proposal.shots[lastStillIndex]!.imageAssetId
      delete proposal.shots[lastStillIndex]!.lastImageAssetId
      memory.setProposal(proposal)
      const checklist = progress.checklist.slice()
      if (checklist[lastStillIndex]) {
        checklist[lastStillIndex] = { ...checklist[lastStillIndex]!, status: 'pending' }
        delete checklist[lastStillIndex]!.stillAssetId
      }
      const next = { ...progress, stage: 'still' as const, shotIndex: lastStillIndex, checklist }
      memory.setProgress(next)
      return next
    }
  }
  memory.setProgress({ ...progress, stage: 'still' })
  return memory.getProgress()
}

async function generateCharacterSheet(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  sheet: AgentCharacterSheet,
): Promise<{ status: 'ready'; stillAssetId: string } | { status: 'failed' | 'cancelled'; error: string }> {
  const identityId = proposal.referenceAssetId
    ?? preferredReferenceAssetId(host.getPreferredAssemblyMedia?.() ?? {})
    ?? firstIdentityStillId(collectIdentityStillIds({
      referenceAssetId: proposal.referenceAssetId,
      preferred: host.getPreferredAssemblyMedia?.(),
      refs: host.refs?.list(),
      assets: host.getState().editorModel.assets,
    }))
  const still = await executeGenerateTool(host, 'generate_image', {
    prompt: sheet.prompt,
    destination: 'assets',
    confirmed: true,
    skipReview: true,
    ...(identityId ? { referenceAssetId: identityId, identityReference: true } : {}),
  })
  if (still.ok === false) {
    return {
      status: String(still.error) === 'Generation cancelled' ? 'cancelled' : 'failed',
      error: String(still.error ?? 'Character sheet generation failed'),
    }
  }
  if (typeof still.assetId !== 'string') {
    return { status: 'failed', error: 'Character sheet generation did not return an asset' }
  }
  return { status: 'ready', stillAssetId: still.assetId }
}

async function generateShotStill(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  shot: AgentAssemblyShot,
  which: 'first' | 'last' = 'first',
): Promise<{ status: 'ready'; stillAssetId: string } | { status: 'failed' | 'cancelled'; error: string }> {
  const identityId = resolveShotIdentity(host, shot, proposal)
  const promptShot = identityId && shot.showProtagonist !== false
    ? { ...shot, showProtagonist: shot.showProtagonist ?? true }
    : shot
  const still = await executeGenerateTool(host, 'generate_image', {
    prompt: stillPromptForShot(promptShot, which),
    destination: 'assets',
    confirmed: true,
    skipReview: true,
    ...(identityId ? { referenceAssetId: identityId, identityReference: true } : {}),
  })
  if (still.ok === false) {
    return {
      status: String(still.error) === 'Generation cancelled' ? 'cancelled' : 'failed',
      error: String(still.error ?? 'Image generation failed'),
    }
  }
  if (typeof still.assetId !== 'string') {
    return { status: 'failed', error: 'Image generation did not return an asset' }
  }
  return { status: 'ready', stillAssetId: still.assetId }
}

async function reviewAssemblyStep(
  host: AgentAssemblyActionHost,
  input: {
    checkpoint: 'character_sheet' | 'still' | 'last_frame' | 'video' | 'next_shot'
    shot: AgentAssemblyShot
    assetId?: string
    nextStep: string
    placed: AgentAssemblyShotResult[]
    checklist: AgentAssemblyShotResult[]
    remaining: number
  },
): Promise<Record<string, unknown>> {
  const asset = input.assetId
    ? host.getState().editorModel.assets.find(item => item.id === input.assetId)
    : undefined
  const preview: AgentReviewPreview | null | undefined = asset && host.readAssetPreview
    ? await host.readAssetPreview(asset)
    : parseReviewPreview(undefined)
  return {
    ok: true,
    needsReview: true,
    checkpoint: input.checkpoint,
    nextStep: input.nextStep,
    shotId: input.shot.id,
    ...(input.shot.title ? { shotTitle: input.shot.title } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(preview ? { preview } : {}),
    remaining: input.remaining,
    placed: input.placed,
    checklist: input.checklist,
  }
}

async function generateAndPlaceShot(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  shot: AgentAssemblyShot,
  startTime: number,
  isFirst: boolean,
  _previousStillId?: string,
  approvedStillId?: string,
): Promise<AgentAssemblyShotResult> {
  if (shot.assetId) {
    return placeExistingShot(host, proposal, shot, startTime)
  }

  const destination = isFirst && proposal.destination === 'gap' ? 'gap' : 'playhead'
  const attachedStillId = resolveShotStillId(host, shot, proposal)
  const identityIds = collectIdentityStillIds({
    referenceAssetId: proposal.referenceAssetId,
    preferred: host.getPreferredAssemblyMedia?.(),
    refs: host.refs?.list(),
    assets: host.getState().editorModel.assets,
  })
  const approvedStart = isIdentityStillId(approvedStillId, identityIds) ? undefined : approvedStillId
  let imageAssetId = approvedStart ?? attachedStillId
  const wantStill = !proposal.skipStills && !shot.skipStill && !imageAssetId

  if (wantStill) {
    const still = await generateShotStill(host, proposal, shot, 'first')
    if (still.status !== 'ready') {
      return {
        id: shot.id,
        ...(shot.title ? { title: shot.title } : {}),
        status: still.status,
        error: still.error,
      }
    }
    imageAssetId = still.stillAssetId
  }

  let lastImageAssetId = isIdentityStillId(shot.lastImageAssetId, identityIds)
    ? undefined
    : shot.lastImageAssetId
  if (!lastImageAssetId && shot.lastFramePrompt && !proposal.skipStills) {
    const lastStill = await generateShotStill(host, proposal, shot, 'last')
    if (lastStill.status === 'ready') lastImageAssetId = lastStill.stillAssetId
  }

  const video = await executeGenerateTool(host, 'generate_video', {
    prompt: videoPromptForShot(shot),
    model: proposal.model,
    duration: Math.max(shot.duration, 5),
    resolution: proposal.resolution,
    audio: proposal.audio || shotImpliesOnCameraVoice(shot) || Boolean(shot.dialogue),
    ...(imageAssetId ? { imageAssetId } : {}),
    ...(lastImageAssetId ? { lastImageAssetId } : {}),
    destination,
    trackIndex: proposal.trackIndex,
    startTime,
    confirmed: true,
    skipReview: true,
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
    titleClipId = addStyledTextClip(host, {
      text: shot.title,
      role: 'shot_title',
      startTime: placedStart,
      duration: Math.min(AGENT_SHOT_TITLE_DURATION_S, placedDuration),
      trackIndex: firstUnlockedTrackIndex(
        (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
          ?? host.getState().editorModel.timelines[0])?.tracks,
        'video',
        AGENT_TITLE_TRACK_INDEX,
      ),
    })
  }

  const placed: AgentAssemblyShotResult = {
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'placed',
    assetId: typeof video.assetId === 'string' ? video.assetId : undefined,
    stillAssetId: imageAssetId,
    clipId,
    start: placedStart,
    duration: placedDuration,
    ...(titleClipId ? { titleClipId } : {}),
  }
  return applyShotLipSync(host, shot, placed)
}

async function placeExistingShot(
  host: AgentAssemblyActionHost,
  proposal: AgentAssemblyProposal,
  shot: AgentAssemblyShot,
  startTime: number,
): Promise<AgentAssemblyShotResult> {
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
    titleClipId = addStyledTextClip(host, {
      text: shot.title,
      role: 'shot_title',
      startTime: placedStart,
      duration: Math.min(AGENT_SHOT_TITLE_DURATION_S, placedDuration),
      trackIndex: firstUnlockedTrackIndex(
        (host.getState().editorModel.timelines.find(item => item.id === host.getState().editorModel.activeTimelineId)
          ?? host.getState().editorModel.timelines[0])?.tracks,
        'video',
        AGENT_TITLE_TRACK_INDEX,
      ),
    })
  }

  const placed: AgentAssemblyShotResult = {
    id: shot.id,
    ...(shot.title ? { title: shot.title } : {}),
    status: 'placed',
    assetId: asset.id,
    clipId: inserted?.id,
    start: placedStart,
    duration: placedDuration,
    ...(titleClipId ? { titleClipId } : {}),
  }
  return applyShotLipSync(host, shot, placed)
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
