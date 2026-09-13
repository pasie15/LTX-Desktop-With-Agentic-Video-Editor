import type { Asset } from '../../../types/project-model'
import type { AgentAssemblyPreferredMedia } from './agent-assembly.ts'
import {
  formatAgentTimecode,
  type AgentChatMessage,
  type AgentMention,
  type AgentPart,
} from './agent-types.ts'

const AT_QUERY = /(^|[\s])@([^\s@]*)$/

export interface MentionQuery {
  start: number
  query: string
}

export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret)
  const match = before.match(AT_QUERY)
  if (!match) return null
  const token = match[2] ?? ''
  const atIndex = before.lastIndexOf('@')
  return { start: atIndex, query: token }
}

export function replaceMentionQuery(text: string, caret: number, inserted: string): { text: string; caret: number } {
  const query = findMentionQuery(text, caret)
  if (!query) {
    const next = `${text}${inserted}`
    return { text: next, caret: next.length }
  }
  const next = `${text.slice(0, query.start)}${inserted}${text.slice(caret)}`
  return { text: next, caret: query.start + inserted.length }
}

export function filterAssetsForMention(assets: Asset[], query: string): Asset[] {
  const lowered = query.trim().toLowerCase()
  const filtered = lowered
    ? assets.filter(asset => (
      asset.prompt.toLowerCase().includes(lowered)
      || asset.id.toLowerCase().includes(lowered)
      || asset.type.toLowerCase().includes(lowered)
    ))
    : assets
  return filtered.slice(0, 12)
}

export function mentionFromAsset(asset: Asset): AgentMention {
  return {
    kind: 'asset',
    id: `asset:${asset.id}`,
    label: asset.prompt || asset.id,
    assetId: asset.id,
    assetType: asset.type,
  }
}

export function mentionFromSelection(clipIds: string[]): AgentMention {
  const count = clipIds.length
  return {
    kind: 'selection',
    id: `selection:${clipIds.slice().sort().join(',') || 'empty'}`,
    label: count === 1 ? 'Selection' : `${count} clips`,
    clipIds,
  }
}

export function mentionFromRange(inPoint: number, outPoint: number): AgentMention {
  return {
    kind: 'range',
    id: `range:${inPoint}:${outPoint}`,
    label: `${formatAgentTimecode(inPoint)}–${formatAgentTimecode(outPoint)}`,
    inPoint,
    outPoint,
  }
}

export function mentionChipLabel(mention: AgentMention): string {
  return mention.label
}

export async function mentionPartsForMessage(
  mentions: AgentMention[],
  assets: Asset[],
  readLocalFile?: (filePath: string) => Promise<{ data: string; mimeType: string }>,
): Promise<AgentPart[]> {
  if (mentions.length === 0) return []
  const parts: AgentPart[] = [{
    type: 'text',
    text: `Mentions:\n${JSON.stringify(mentions.map(compactMention), null, 2)}`,
  }]
  if (!readLocalFile) return parts
  for (const mention of mentions) {
    if (mention.kind !== 'asset' || mention.assetType !== 'image' || !mention.assetId) continue
    const asset = assets.find(item => item.id === mention.assetId)
    const path = asset?.path
    if (!path) continue
    try {
      const file = await readLocalFile(path)
      parts.push({
        type: 'inline_image',
        mimeType: file.mimeType,
        data: file.data,
        name: mention.label,
      })
    } catch {
      // Still mentions stay textual if the file can't be inlined.
    }
  }
  return parts
}

export function mentionsFromMessages(messages: AgentChatMessage[]): AgentMention[] {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type !== 'text' || !part.text.startsWith('Mentions:')) continue
      const raw = part.text.slice('Mentions:'.length).trim()
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) continue
        return parsed.flatMap(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return []
          const record = item as Record<string, unknown>
          if (record.kind !== 'asset' || typeof record.assetId !== 'string') return []
          return [{
            kind: 'asset' as const,
            id: typeof record.id === 'string' ? record.id : record.assetId,
            label: typeof record.label === 'string' ? record.label : record.assetId,
            assetId: record.assetId,
            assetType: typeof record.assetType === 'string'
              ? record.assetType as AgentMention['assetType']
              : undefined,
          }]
        })
      } catch {
        return []
      }
    }
  }
  return []
}

export function preferredAssemblyMediaFromMentions(
  mentions: AgentMention[],
  assets: Asset[],
): AgentAssemblyPreferredMedia {
  const mentionedIds = new Set(
    mentions.filter(mention => mention.kind === 'asset' && mention.assetId).map(mention => mention.assetId!),
  )
  const mentioned = assets.filter(asset => mentionedIds.has(asset.id))
  const image = mentioned.find(asset => asset.type === 'image')
  const audio = mentioned.find(asset => asset.type === 'audio')
  return {
    ...(image ? { imageAssetId: image.id } : {}),
    ...(audio ? { musicAssetId: audio.id } : {}),
  }
}

function compactMention(mention: AgentMention): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    kind: mention.kind,
    id: mention.id,
    label: mention.label,
  }
  if (mention.assetId) payload.assetId = mention.assetId
  if (mention.assetType) payload.assetType = mention.assetType
  if (mention.clipIds?.length) payload.clipIds = mention.clipIds
  if (mention.inPoint != null) payload.inPoint = mention.inPoint
  if (mention.outPoint != null) payload.outPoint = mention.outPoint
  return payload
}
