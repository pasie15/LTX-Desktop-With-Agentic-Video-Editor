import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_STARTER_PROMPTS,
  resolveStarterComposerText,
  shouldAutoSendStarter,
} from './agent-starters.ts'

describe('agent starter chips', () => {
  it('includes the LTX starter prompts', () => {
    assert.deepEqual(
      AGENT_STARTER_PROMPTS.map(starter => starter.label),
      [
        'Generate an LTX preview video of …',
        'Fill the selected gap',
        'Generate B-roll for this timeline',
        'Assemble this script on the timeline',
        'Make a short film about …',
        'Add titles / subtitles',
        'Add voiceover and music',
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

    const assemble = AGENT_STARTER_PROMPTS.find(starter => starter.id === 'assemble-script')
    assert.ok(assemble)
    assert.match(resolveStarterComposerText(assemble), /Assemble this script on the timeline:/)

    const broll = AGENT_STARTER_PROMPTS.find(starter => starter.id === 'b-roll')
    assert.ok(broll)
    assert.match(resolveStarterComposerText(broll), /Propose a shot list/)

    for (const starter of AGENT_STARTER_PROMPTS) {
      if (starter.id === 'fill-gap') continue
      assert.equal(shouldAutoSendStarter(starter, true), false)
    }
  })
})
