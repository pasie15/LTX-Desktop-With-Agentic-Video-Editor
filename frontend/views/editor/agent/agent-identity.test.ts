import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectIdentityStillIds,
  isCharacterSheetAsset,
  isImportedStill,
  isIdentityStillId,
  isUsableVideoStart,
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

  it('collects imported photos and generated lookbooks as identity ids', () => {
    const sheet = { id: 'sheet', type: 'image', generationParams: { prompt: 'lookbook' } }
    const scene = { id: 'scene', type: 'image', generationParams: { prompt: 'Cinematic 16:9 production still, wet street' } }
    const ids = collectIdentityStillIds({
      assets: [
        { id: 'ken', type: 'image' },
        sheet,
        scene,
        { id: 'river', type: 'audio' },
      ],
      extraIds: ['tracked-sheet'],
    })
    assert.equal(isCharacterSheetAsset(sheet), true)
    assert.equal(isCharacterSheetAsset(scene), false)
    assert.equal(ids.has('ken'), true)
    assert.equal(ids.has('sheet'), true)
    assert.equal(ids.has('tracked-sheet'), true)
    assert.equal(ids.has('scene'), false)
    assert.equal(isIdentityStillId('ken', ids), true)
    assert.equal(isUsableVideoStart('sheet', sheet, ids), false)
    assert.equal(isUsableVideoStart('scene', scene, ids), true)
    assert.deepEqual(withoutIdentityStartFrames({
      imageAssetId: 'ken',
      skipStill: true,
    }, ids), {})
    assert.deepEqual(withoutIdentityStartFrames({
      imageAssetId: 'sheet',
    }, ids), {})
  })
})
