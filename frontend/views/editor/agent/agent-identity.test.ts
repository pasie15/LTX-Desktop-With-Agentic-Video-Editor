import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectIdentityStillIds,
  isImportedStill,
  isIdentityStillId,
  withoutIdentityStartFrames,
} from './agent-identity.ts'

describe('imported stills are identity, not start frames', () => {
  it('treats images without generationParams as imported', () => {
    assert.equal(isImportedStill({ id: 'ken', type: 'image' }), true)
    assert.equal(isImportedStill({
      id: 'scene',
      type: 'image',
      generationParams: { prompt: 'wet street' },
    }), false)
    assert.equal(isImportedStill({ id: 'song', type: 'audio' }), false)
  })

  it('collects imported project photos as identity ids', () => {
    const ids = collectIdentityStillIds({
      assets: [
        { id: 'ken', type: 'image' },
        { id: 'sheet', type: 'image', generationParams: { prompt: 'lookbook' } },
        { id: 'river', type: 'audio' },
      ],
    })
    assert.equal(ids.has('ken'), true)
    assert.equal(ids.has('sheet'), false)
    assert.equal(isIdentityStillId('ken', ids), true)
    assert.deepEqual(withoutIdentityStartFrames({
      imageAssetId: 'ken',
      skipStill: true,
    }, ids), {})
  })
})
