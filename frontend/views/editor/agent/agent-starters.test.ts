import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_STARTER_PROMPTS,
  resolveStarterComposerText,
  shouldAutoSendStarter,
} from './agent-starters.ts'

describe('agent starter chips', () => {
  it('includes the six LTX starter prompts', () => {
    assert.deepEqual(
      AGENT_STARTER_PROMPTS.map(starter => starter.label),
      [
        'Generate an LTX preview video of …',
        'Fill the selected gap',
        'Generate B-roll for this timeline',
        'Assemble this script on the timeline',
        'Add titles / subtitles',
        'Organize assets into bins',
      ],
    )
  })

  it('fills the composer without auto-sending except fill-gap when a gap is selected', () => {
    const fillGap = AGENT_STARTER_PROMPTS.find(starter => starter.id === 'fill-gap')
    assert.ok(fillGap)
    assert.equal(resolveStarterComposerText(fillGap), 'Fill the selected gap')
    assert.equal(shouldAutoSendStarter(fillGap, false), false)
    assert.equal(shouldAutoSendStarter(fillGap, true), true)

    for (const starter of AGENT_STARTER_PROMPTS) {
      if (starter.id === 'fill-gap') continue
      assert.equal(shouldAutoSendStarter(starter, true), false)
    }
  })
})
