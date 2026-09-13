import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GENERATION_SLOT_WAIT_STATUS, waitForGenerationSlot } from './agent-generation-slot.ts'

describe('generation slot wait', () => {
  it('returns immediately when the slot is free', async () => {
    const result = await waitForGenerationSlot({
      isOccupied: () => false,
      intervalMs: 10,
    })
    assert.deepEqual(result, { ok: true })
  })

  it('waits until the slot frees and announces once', async () => {
    let remaining = 3
    let announced = 0
    const result = await waitForGenerationSlot({
      isOccupied: () => {
        remaining -= 1
        return remaining > 0
      },
      intervalMs: 5,
      onWaiting: () => { announced += 1 },
    })
    assert.deepEqual(result, { ok: true })
    assert.equal(announced, 1)
    assert.equal(GENERATION_SLOT_WAIT_STATUS.includes('Waiting'), true)
  })

  it('stops waiting when the abort signal fires', async () => {
    const controller = new AbortController()
    const pending = waitForGenerationSlot({
      isOccupied: () => true,
      signal: controller.signal,
      intervalMs: 15,
    })
    setTimeout(() => controller.abort(), 20)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal('cancelled' in result && result.cancelled, true)
  })
})
