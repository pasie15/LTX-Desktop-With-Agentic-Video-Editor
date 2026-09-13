import type { GenerationSettings } from '../../../components/SettingsPanel'
import { ApiClient, type ApiRequestBodyOf } from '../../../lib/api-client'
import { buildGenerateVideoImageInputs } from '../../../lib/build-generate-video-body'
import { canCancelLocalJob, withGenerationActive } from '../../../lib/generation-active'
import { GENERATION_RECOVERY_KEY, type GenerationRecoveryContext } from '../../../hooks/use-generation'
import type { VideoGenerationPipeline } from '../../../lib/video-generation-model-specs'
import { GENERATION_SLOT_WAIT_STATUS, waitForGenerationSlot } from './agent-generation-slot.ts'
import type { AgentGenerateJobResult, AgentGenerateSettings, AgentGenerationJobs, AgentPersistedVisualAsset } from './agent-generate-runtime.ts'

type GenerateVideoRequest = ApiRequestBodyOf<'generateVideo'>

const IMAGE_SHORT_SIDE_BY_RESOLUTION: Record<string, number> = {
  '1080p': 1080,
  '1440p': 1440,
  '2048p': 2048,
}

const IMAGE_ASPECT_RATIO_VALUE: Record<string, number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '21:9': 21 / 9,
}

function imageDimensions(settings: AgentGenerateSettings): { width: number; height: number } {
  const shortSide = IMAGE_SHORT_SIDE_BY_RESOLUTION[settings.imageResolution] ?? 1080
  const ratio = IMAGE_ASPECT_RATIO_VALUE[settings.imageAspectRatio] ?? 16 / 9
  if (ratio >= 1) return { width: Math.round(shortSide * ratio), height: shortSide }
  return { width: shortSide, height: Math.round(shortSide / ratio) }
}

function toGenerationSettings(settings: AgentGenerateSettings): GenerationSettings {
  return {
    model: settings.model as VideoGenerationPipeline,
    duration: settings.duration,
    videoResolution: settings.videoResolution,
    fps: settings.fps,
    audio: settings.audio,
    cameraMotion: settings.cameraMotion,
    aspectRatio: settings.aspectRatio,
    imageResolution: settings.imageResolution,
    imageAspectRatio: settings.imageAspectRatio,
    imageSteps: settings.imageSteps,
    variations: 1,
  }
}

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { error?: { message?: string }; message?: string }
    if (record.error?.message) return record.error.message
    if (record.message) return record.message
  }
  return 'Generation failed'
}

export interface CreateAgentGenerationJobsInput {
  projectId: string
  isBusy: () => boolean
  persistVisualAsset: (srcPath: string, type: 'video' | 'image') => Promise<AgentPersistedVisualAsset | null>
  shouldVideoGenerateWithLtxApi: boolean
  shouldImageGenerateWithFalApi: boolean
}

export function createAgentGenerationJobs(input: CreateAgentGenerationJobsInput): AgentGenerationJobs {
  let inFlight = false
  let cancelRequested = false

  const cancel = () => {
    cancelRequested = true
    void ApiClient.cancelGeneration()
  }

  const writeMarker = async (prompt: string, genType: 'image' | 'video') => {
    const before = await ApiClient.getGenerationProgress()
    if (!before.ok) return
    const canCancel = canCancelLocalJob(
      genType,
      input.shouldVideoGenerateWithLtxApi,
      input.shouldImageGenerateWithFalApi,
    )
    const marker: GenerationRecoveryContext = {
      projectId: input.projectId,
      prompt,
      ...(genType === 'image' ? { genType: 'image' as const } : {}),
      baselineId: before.data.id ?? null,
      canCancel,
    }
    localStorage.setItem(GENERATION_RECOVERY_KEY, JSON.stringify(marker))
  }

  const clearMarker = () => {
    localStorage.removeItem(GENERATION_RECOVERY_KEY)
  }

  const isSlotOccupied = async () => {
    if (inFlight || input.isBusy()) return true
    try {
      const progress = await ApiClient.getGenerationProgress()
      if (!progress.ok) return true
      return progress.data.status === 'running'
    } catch {
      return true
    }
  }

  const waitForSlot: NonNullable<AgentGenerationJobs['waitForSlot']> = async ({ signal, onWaiting }) => {
    return waitForGenerationSlot({
      isOccupied: isSlotOccupied,
      signal,
      onWaiting,
    })
  }

  const pollUntilSettled = async (
    onProgress?: (progress: { percent: number; status: string }) => void,
  ) => {
    const timer = setInterval(() => {
      void ApiClient.getGenerationProgress().then(result => {
        if (!result.ok) return
        onProgress?.({
          percent: result.data.progress,
          status: result.data.phase === 'inference'
            ? 'Generating...'
            : result.data.phase === 'cancelled'
              ? 'Cancelling…'
              : result.data.phase === 'loading_model'
                ? 'Loading model...'
                : result.data.phase === 'complete'
                  ? 'Finalizing...'
                  : 'Generating...',
        })
      })
    }, 500)
    return () => clearInterval(timer)
  }

  const runImage: AgentGenerationJobs['runImage'] = async ({ prompt, settings, signal, onProgress }) => {
    const waited = await waitForSlot({
      signal,
      onWaiting: () => onProgress?.({ percent: 0, status: GENERATION_SLOT_WAIT_STATUS }),
    })
    if (!waited.ok) {
      if ('cancelled' in waited) return { status: 'cancelled' }
      return { status: 'error', error: waited.error }
    }
    inFlight = true
    cancelRequested = false
    const abort = () => { cancel() }
    signal?.addEventListener('abort', abort)
    try {
      await writeMarker(prompt, 'image')
      const stopPoll = await pollUntilSettled(onProgress)
      const dims = imageDimensions(settings)
      const videoSettings = toGenerationSettings(settings)
      const result = await withGenerationActive(() => ApiClient.generateImage({
        prompt,
        width: dims.width,
        height: dims.height,
        numSteps: videoSettings.imageSteps || 4,
        numImages: 1,
        strength: 0.6,
      }))
      stopPoll()
      if (signal?.aborted || cancelRequested) {
        clearMarker()
        return { status: 'cancelled' }
      }
      if (!result.ok) {
        clearMarker()
        return { status: 'error', error: apiErrorMessage(result.error) }
      }
      if (result.data.status === 'cancelled') {
        clearMarker()
        return { status: 'cancelled' }
      }
      const paths = result.data.image_paths
      const path = paths[0]
      if (!path) {
        clearMarker()
        return { status: 'error', error: 'Image generation completed without output images' }
      }
      clearMarker()
      return { status: 'complete', path, paths }
    } catch (error) {
      clearMarker()
      return { status: 'error', error: error instanceof Error ? error.message : 'Image generation failed' }
    } finally {
      signal?.removeEventListener('abort', abort)
      inFlight = false
    }
  }

  const runVideo: AgentGenerationJobs['runVideo'] = async ({ prompt, imagePath, settings, signal, onProgress }) => {
    const waited = await waitForSlot({
      signal,
      onWaiting: () => onProgress?.({ percent: 0, status: GENERATION_SLOT_WAIT_STATUS }),
    })
    if (!waited.ok) {
      if ('cancelled' in waited) return { status: 'cancelled' }
      return { status: 'error', error: waited.error }
    }
    inFlight = true
    cancelRequested = false
    const abort = () => { cancel() }
    signal?.addEventListener('abort', abort)
    try {
      await writeMarker(prompt, 'video')
      const stopPoll = await pollUntilSettled(onProgress)
      const body: Record<string, unknown> = {
        prompt,
        model: settings.model,
        duration: settings.duration,
        resolution: settings.videoResolution,
        fps: settings.fps,
        audio: settings.audio,
        cameraMotion: settings.cameraMotion,
        negativePrompt: '',
        aspectRatio: settings.aspectRatio === '9:16' ? '9:16' : '16:9',
        ...buildGenerateVideoImageInputs({
          mode: 'video',
          imagePath,
          lastImagePath: null,
          keyframes: [],
        }),
      }
      const result = await withGenerationActive(() => ApiClient.generateVideo(body as GenerateVideoRequest))
      stopPoll()
      if (signal?.aborted || cancelRequested) {
        clearMarker()
        return { status: 'cancelled' }
      }
      if (!result.ok) {
        clearMarker()
        return { status: 'error', error: apiErrorMessage(result.error) }
      }
      if (result.data.status === 'cancelled') {
        clearMarker()
        return { status: 'cancelled' }
      }
      const path = result.data.video_path
      if (!path) {
        clearMarker()
        return { status: 'error', error: 'Video generation completed without an output file' }
      }
      clearMarker()
      return { status: 'complete', path }
    } catch (error) {
      clearMarker()
      return { status: 'error', error: error instanceof Error ? error.message : 'Video generation failed' }
    } finally {
      signal?.removeEventListener('abort', abort)
      inFlight = false
    }
  }

  return {
    isBusy: () => input.isBusy() || inFlight,
    runImage,
    runVideo,
    waitForSlot,
    enhancePrompt: async (prompt, mediaType) => {
      const waited = await waitForSlot({})
      if (!waited.ok) return { ok: false, error: 'cancelled' in waited ? 'Generation cancelled' : waited.error }
      const result = await withGenerationActive(() => ApiClient.enhancePrompt({
        prompt,
        mediaType,
        provider: 'api',
      }))
      if (!result.ok) return { ok: false, error: apiErrorMessage(result.error) }
      return { ok: true, prompt: result.data.enhancedPrompt }
    },
    cancel,
    persistVisualAsset: input.persistVisualAsset,
  }
}

export type { AgentGenerateJobResult }
