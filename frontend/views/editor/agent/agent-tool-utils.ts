export function validateUnknownKeys(args: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) return `Unknown argument: ${key}`
  }
  return null
}

export function toolErrorResult(message: string): Record<string, unknown> {
  return { ok: false, error: message }
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function asBoolean(value: unknown): boolean {
  return value === true
}

export function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map(item => item.trim())
}

export async function listGenerationModels(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetchImpl('/api/generate/models-specs')
    if (!response.ok) {
      return toolErrorResult(`models-specs failed (${response.status})`)
    }
    const payload = await response.json() as {
      local_models?: Array<{ pipeline: string; spec: { display_name: string; supported_resolutions_durations: Record<string, { fps_to_durations: Record<string, number[]> }> } }>
      api_models?: Array<{ pipeline: string; spec: { display_name: string; supported_resolutions_durations: Record<string, { fps_to_durations: Record<string, number[]> }> } }>
    }
    const compact = (items: typeof payload.local_models = []) => items.map(item => ({
      pipeline: item.pipeline,
      displayName: item.spec.display_name,
      resolutions: Object.fromEntries(
        Object.entries(item.spec.supported_resolutions_durations).map(([resolution, spec]) => [
          resolution,
          spec.fps_to_durations,
        ]),
      ),
    }))
    return {
      ok: true,
      local: compact(payload.local_models),
      api: compact(payload.api_models),
    }
  } catch (error) {
    return toolErrorResult(error instanceof Error ? error.message : 'Failed to list models')
  }
}
