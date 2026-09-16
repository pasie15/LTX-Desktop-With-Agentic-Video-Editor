import type { AgentRef } from './agent-refs.ts'

export interface IdentityPreferredMedia {
  imageAssetId?: string
  referenceAssetId?: string
}

export interface IdentityStillAsset {
  id: string
  type: string
  generationParams?: unknown
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
    if (isImportedStill(asset)) add(asset.id)
  }
  return ids
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
