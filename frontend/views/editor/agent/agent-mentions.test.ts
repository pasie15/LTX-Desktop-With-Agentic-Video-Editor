import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterAssetsForMention,
  findMentionQuery,
  mentionFromAsset,
  mentionFromRange,
  mentionFromSelection,
  mentionPartsForMessage,
  mentionsFromMessages,
  preferredAssemblyMediaFromMentions,
  replaceMentionQuery,
} from './agent-mentions.ts'
import { formatAgentTimecode } from './agent-types.ts'
import type { Asset } from '../../../types/project-model.ts'

const still: Asset = {
  id: 'img-1',
  type: 'image',
  path: '/tmp/still.png',
  prompt: 'Hero still',
  resolution: '1080p',
  createdAt: 1,
}

describe('agent mentions', () => {
  it('detects an @ query at the caret', () => {
    assert.deepEqual(findMentionQuery('see @her', 8), { start: 4, query: 'her' })
    assert.equal(findMentionQuery('see her', 7), null)
  })

  it('filters assets and builds mention chips', () => {
    const video: Asset = { ...still, id: 'vid-1', type: 'video', prompt: 'B-roll' }
    const music: Asset = { ...still, id: 'aud-1', type: 'audio', prompt: 'Theme music' }
    assert.deepEqual(filterAssetsForMention([still, video], 'hero').map(asset => asset.id), ['img-1'])
    assert.deepEqual(filterAssetsForMention([still, video, music], 'audio').map(asset => asset.id), ['aud-1'])
    assert.equal(mentionFromAsset(music).assetType, 'audio')
    assert.equal(mentionFromAsset(still).assetId, 'img-1')
    assert.deepEqual(mentionFromSelection(['c1', 'c2']).clipIds, ['c1', 'c2'])
    assert.equal(mentionFromRange(4.2, 8).label, `${formatAgentTimecode(4.2)}–${formatAgentTimecode(8)}`)
  })

  it('inlines still bytes and leaves the @ token', async () => {
    const parts = await mentionPartsForMessage(
      [mentionFromAsset(still)],
      [still],
      async () => ({ data: 'abc', mimeType: 'image/png' }),
    )
    assert.equal(parts[0]?.type, 'text')
    assert.equal(parts[1]?.type, 'inline_image')
    const replaced = replaceMentionQuery('Look at @he', 11, '')
    assert.equal(replaced.text, 'Look at ')
  })

  it('reads mentioned still and song from the last user message', () => {
    const music: Asset = { ...still, id: 'aud-1', type: 'audio', prompt: 'Midnight' }
    const mentions = mentionsFromMessages([{
      id: 'm1',
      role: 'user',
      createdAt: 1,
      parts: [{
        type: 'text',
        text: `Mentions:\n${JSON.stringify([
          { kind: 'asset', id: 'n1', label: 'Ken Tune', assetId: 'img-1', assetType: 'image' },
          { kind: 'asset', id: 'n2', label: 'Midnight', assetId: 'aud-1', assetType: 'audio' },
        ])}`,
      }],
    }])
    assert.deepEqual(preferredAssemblyMediaFromMentions(mentions, [still, music]), {
      imageAssetId: 'img-1',
      musicAssetId: 'aud-1',
    })
  })

  it('formats human timecode as m:ss.t', () => {
    assert.equal(formatAgentTimecode(4.2), '0:04.2')
    assert.equal(formatAgentTimecode(65), '1:05.0')
  })
})
