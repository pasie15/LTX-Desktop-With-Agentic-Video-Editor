export const GENERATION_SLOT_WAIT_STATUS = 'Waiting for generation slot…'

export function slotOccupiedFromProgress(input: {
  inFlight: boolean
  locallyActive?: boolean
  progress: { ok: boolean; data?: { status?: string } } | null
}): boolean {
  if (input.inFlight || input.locallyActive) return true
  if (!input.progress || !input.progress.ok) return false
  return input.progress.data?.status === 'running'
}

export type GenerationSlotWaitResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }

export async function waitForGenerationSlot(input: {
  isOccupied: () => boolean | Promise<boolean>
  signal?: AbortSignal | null
  intervalMs?: number
  onWaiting?: () => void
}): Promise<GenerationSlotWaitResult> {
  const intervalMs = input.intervalMs ?? 250
  input.onWaiting?.()

  while (await input.isOccupied()) {
    if (input.signal?.aborted) return { ok: false, cancelled: true }
    input.onWaiting?.()
    await sleep(intervalMs, input.signal)
  }

  if (input.signal?.aborted) return { ok: false, cancelled: true }
  return { ok: true }
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function slotWaitError(result: GenerationSlotWaitResult): Record<string, unknown> | null {
  if (result.ok) return null
  if ('cancelled' in result && result.cancelled) {
    return { ok: false, error: 'Generation cancelled' }
  }
  return { ok: false, error: 'error' in result ? result.error : 'Generation cancelled' }
}
