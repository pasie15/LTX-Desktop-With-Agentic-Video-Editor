import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectImportedMediaType,
  importLocalMediaPath,
  type ImportLocalMediaCopyFns,
} from './import-local-media.ts'

function fakeCopy(overrides?: Partial<ImportLocalMediaCopyFns>): ImportLocalMediaCopyFns {
  return {
    copyVisual: async (srcPath, _projectId, type) => ({
      path: `/project/${type}/${srcPath.split(/[\\/]/).pop()}`,
      bigThumbnailPath: '/project/big.jpg',
      smallThumbnailPath: '/project/small.jpg',
      width: 1280,
      height: 720,
    }),
    copyGeneric: async srcPath => ({ path: `/project/audio/${srcPath.split(/[\\/]/).pop()}` }),
    probeDuration: async () => 12.5,
    now: () => 1000,
    createId: () => 'asset-imported',
    ...overrides,
  }
}

describe('detectImportedMediaType', () => {
  it('reads mime, extension, and explicit type', () => {
    assert.equal(detectImportedMediaType({ mimeType: 'audio/mpeg' }), 'audio')
    assert.equal(detectImportedMediaType({ mimeType: 'video/mp4' }), 'video')
    assert.equal(detectImportedMediaType({ mimeType: 'image/png' }), 'image')
    assert.equal(detectImportedMediaType({ path: 'C:\\Music\\score.wav' }), 'audio')
    assert.equal(detectImportedMediaType({ name: 'hero.webp' }), 'image')
    assert.equal(detectImportedMediaType({ path: '/tmp/cut.mov' }), 'video')
    assert.equal(detectImportedMediaType({ path: 'notes.txt' }), null)
    assert.equal(detectImportedMediaType({ path: 'odd.bin', type: 'audio' }), 'audio')
  })
})

describe('importLocalMediaPath', () => {
  it('copies audio and probes duration', async () => {
    const asset = await importLocalMediaPath({
      srcPath: '/tmp/theme.mp3',
      projectId: 'proj-1',
      copy: fakeCopy(),
    })
    assert.ok(asset)
    assert.equal(asset.type, 'audio')
    assert.equal(asset.path, '/project/audio/theme.mp3')
    assert.equal(asset.duration, 12.5)
    assert.equal(asset.prompt, 'Imported: theme.mp3')
  })

  it('copies stills with thumbnails and skips duration probe', async () => {
    const asset = await importLocalMediaPath({
      srcPath: '/tmp/still.png',
      projectId: 'proj-1',
      copy: fakeCopy({
        probeDuration: async () => {
          throw new Error('images should not probe')
        },
      }),
    })
    assert.ok(asset)
    assert.equal(asset.type, 'image')
    assert.equal(asset.path, '/project/image/still.png')
    assert.equal(asset.bigThumbnailPath, '/project/big.jpg')
    assert.equal(asset.duration, 5)
  })

  it('returns null for unsupported files and failed visual copies', async () => {
    assert.equal(await importLocalMediaPath({
      srcPath: '/tmp/notes.txt',
      projectId: 'proj-1',
      copy: fakeCopy(),
    }), null)
    assert.equal(await importLocalMediaPath({
      srcPath: '/tmp/cut.mp4',
      projectId: 'proj-1',
      copy: fakeCopy({ copyVisual: async () => null }),
    }), null)
  })
})
