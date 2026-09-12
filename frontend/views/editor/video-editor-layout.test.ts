import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  normalizeEditorLayout,
  shouldCollapsePropertiesForAgentChat,
} from './editor-layout.ts'

describe('editor layout chat panel', () => {
  it('defaults chat width to 360 and clamps to 280–480', () => {
    assert.equal(DEFAULT_LAYOUT.chatPanelWidth, 360)
    assert.deepEqual(LAYOUT_LIMITS.chatPanelWidth, { min: 280, max: 480 })
    assert.equal(normalizeEditorLayout({}).chatPanelWidth, 360)
    assert.equal(normalizeEditorLayout({ chatPanelWidth: 200 }).chatPanelWidth, 280)
    assert.equal(normalizeEditorLayout({ chatPanelWidth: 800 }).chatPanelWidth, 480)
  })

  it('preserves other layout fields when chat width is missing from old saves', () => {
    const next = normalizeEditorLayout({
      leftPanelWidth: 300,
      rightPanelWidth: 240,
      timelineHeight: 200,
      assetsHeight: 160,
    })
    assert.equal(next.leftPanelWidth, 300)
    assert.equal(next.chatPanelWidth, 360)
  })

  it('collapses Properties when opening Agent below 1400px', () => {
    assert.equal(shouldCollapsePropertiesForAgentChat(1399), true)
    assert.equal(shouldCollapsePropertiesForAgentChat(1400), false)
  })
})
