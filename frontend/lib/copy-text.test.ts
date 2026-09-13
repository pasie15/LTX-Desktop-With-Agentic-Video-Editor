import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { copyText } from './copy-text.ts'

describe('copyText', () => {
  it('writes the code with the clipboard API when available', async () => {
    const writes: string[] = []
    const previous = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (value: string) => {
            writes.push(value)
          },
        },
      },
    })
    try {
      assert.equal(await copyText('  ABCD-EFGH  '), true)
      assert.deepEqual(writes, ['ABCD-EFGH'])
      assert.equal(await copyText('   '), false)
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previous,
      })
    }
  })
})
