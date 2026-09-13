import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compactAgentRefs,
  createMemoryRefStore,
  parseAgentRefs,
  resolveRefImageAssetId,
} from './agent-refs.ts'

describe('agent refs library', () => {
  it('parses and resolves named stills', () => {
    const refs = parseAgentRefs([
      { id: 'ref-boy', name: 'Paper boy', role: 'character', assetId: 'still-1' },
      { id: 'bad', name: '', assetId: '' },
    ])
    assert.equal(refs.length, 1)
    assert.equal(resolveRefImageAssetId(refs, 'ref-boy'), 'still-1')
    assert.equal(resolveRefImageAssetId(refs, 'missing'), null)
    assert.deepEqual(compactAgentRefs(refs)[0], refs[0])
  })

  it('registers and forgets without inventing asset ids', () => {
    const store = createMemoryRefStore()
    const ref = store.register({ name: ' stoop ', assetId: 'still-2', role: 'location' })
    assert.equal(ref.name, 'stoop')
    assert.equal(ref.assetId, 'still-2')
    assert.equal(store.resolveImageAssetId(ref.id), 'still-2')
    assert.equal(store.forget(ref.id), true)
    assert.equal(store.list().length, 0)
    assert.equal(store.forget(ref.id), false)
  })
})
