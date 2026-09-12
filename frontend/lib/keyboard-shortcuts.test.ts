import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTION_REGISTRY,
  AVID_LAYOUT,
  DAVINCI_LAYOUT,
  LTX_DEFAULT_LAYOUT,
  PREMIERE_LAYOUT,
  formatKeyCombo,
} from './keyboard-shortcuts.ts'

describe('view.agentChat', () => {
  it('is registered as a remappable timeline action', () => {
    const action = ACTION_REGISTRY.find(entry => entry.id === 'view.agentChat')
    assert.ok(action)
    assert.equal(action.label, 'Show / Hide Agent')
    assert.equal(action.category, 'Timeline')
  })

  it('defaults to Ctrl+` on every built-in preset', () => {
    const presets = [LTX_DEFAULT_LAYOUT, PREMIERE_LAYOUT, DAVINCI_LAYOUT, AVID_LAYOUT]
    for (const layout of presets) {
      const combos = layout['view.agentChat']
      assert.ok(combos && combos.length > 0)
      assert.equal(formatKeyCombo(combos[0]), 'Ctrl+`')
    }
  })
})
