import type { AgentRef } from './agent-refs.ts'
import { isLookbookPrompt } from './agent-still-prompts.ts'

export interface IdentityPreferredMedia {
  imageAssetId?: string
  referenceAssetId?: string
}

export interface IdentityStillAsset {
  id: string
  type: string
  prompt?: string
  generationParams?: unknown
}

export function promptFromAsset(asset: IdentityStillAsset): string {
  const params = asset.generationParams
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const prompt = (params as { prompt?: unknown }).prompt
    if (typeof prompt === 'string') return prompt
  }
  return asset.prompt ?? ''
}

/** Generated lookbooks are identity bibles, never i2v start frames. */
export function isCharacterSheetAsset(asset?: IdentityStillAsset | null): boolean {
  return Boolean(asset && asset.type === 'image' && isLookbookPrompt(promptFromAsset(asset)))
}

export interface IdentityShotFields {
  imageAssetId?: string
  lastImageAssetId?: string
  skipStill?: boolean
}

/** User-imported photos have no generationParams. Those are identity, never start frames. */
export function isImportedStill(asset?: IdentityStillAsset | null): boolean {
  return Boolean(asset && asset.type === 'image' && !asset.generationParams)
}

export function collectIdentityStillIds(input: {
  referenceAssetId?: string | null
  preferred?: IdentityPreferredMedia
  refs?: readonly AgentRef[]
  assets?: readonly IdentityStillAsset[]
  extraIds?: readonly string[]
}): Set<string> {
  const ids = new Set<string>()
  const add = (value?: string | null) => {
    const trimmed = value?.trim()
    if (trimmed) ids.add(trimmed)
  }
  add(input.referenceAssetId)
  add(input.preferred?.referenceAssetId)
  add(input.preferred?.imageAssetId)
  for (const ref of input.refs ?? []) {
    if (ref.role === 'character') add(ref.assetId)
  }
  for (const asset of input.assets ?? []) {
    if (isImportedStill(asset) || isCharacterSheetAsset(asset)) add(asset.id)
  }
  for (const id of input.extraIds ?? []) add(id)
  return ids
}

/** Scene stills only. Portraits and lookbooks are identity, never i2v pixels. */
export function isUsableVideoStart(
  assetId: string | undefined,
  asset: IdentityStillAsset | null | undefined,
  identityIds: Set<string>,
): boolean {
  if (!assetId || !asset || asset.type !== 'image') return false
  if (isImportedStill(asset) || isCharacterSheetAsset(asset)) return false
  if (isIdentityStillId(assetId, identityIds)) return false
  return true
}

export function isIdentityStillId(assetId: string | undefined, identityIds: Set<string>): boolean {
  return Boolean(assetId && identityIds.has(assetId))
}

export function firstIdentityStillId(identityIds: Set<string>): string | undefined {
  return identityIds.values().next().value
}

export function withoutIdentityStartFrames<T extends IdentityShotFields>(
  shot: T,
  identityIds: Set<string>,
): T {
  const next = { ...shot }
  if (isIdentityStillId(next.imageAssetId, identityIds)) {
    delete next.imageAssetId
    delete next.skipStill
  }
  if (isIdentityStillId(next.lastImageAssetId, identityIds)) {
    delete next.lastImageAssetId
  }
  return next
}
