import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listGenerationModels, validateUnknownKeys } from './agent-tool-utils.ts'

describe('read tool executor', () => {
  it('rejects unknown argument keys', () => {
    assert.equal(validateUnknownKeys({ start: 0, extra: 1 }, ['start', 'end']), 'Unknown argument: extra')
    assert.equal(validateUnknownKeys({ start: 0 }, ['start', 'end']), null)
  })

  it('lists generation models through the injected fetch', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      local_models: [{
        pipeline: 'fast',
        spec: {
          display_name: 'LTX Fast',
          supported_resolutions_durations: { '1080p': { fps_to_durations: { '24': [4, 8] } } },
        },
      }],
      api_models: [],
    }), { status: 200 })
    const result = await listGenerationModels(fetchImpl)
    assert.equal(result.ok, true)
    assert.deepEqual(result.local, [{
      pipeline: 'fast',
      displayName: 'LTX Fast',
      resolutions: { '1080p': { '24': [4, 8] } },
    }])
  })
})
