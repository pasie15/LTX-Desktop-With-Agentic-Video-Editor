import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agentChatContextMenuKind,
  hasDomTextSelection,
  shouldIgnoreEditorShortcut,
} from './text-editing-context.ts'

describe('text editing context', () => {
  it('leaves clipboard shortcuts alone when text is selected', () => {
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.copy', { hasTextSelection: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.cut', { hasTextSelection: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.selectAll', { hasTextSelection: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.copy', { hasTextSelection: false }), false)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'view.agentChat', { hasTextSelection: true }), false)
  })

  it('leaves all editor shortcuts alone inside the agent chat except the toggle', () => {
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.copy', { insideAgentChat: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.cut', { insideAgentChat: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.paste', { insideAgentChat: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.delete', { insideAgentChat: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'transport.playPause', { insideAgentChat: true }), true)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'view.agentChat', { insideAgentChat: true }), false)
    assert.equal(shouldIgnoreEditorShortcut({ target: null }, 'edit.copy', { isEditable: true }), true)
  })

  it('uses the native menu for fields and selections, and a panel menu otherwise', () => {
    assert.equal(agentChatContextMenuKind({ isEditable: true, hasTextSelection: false }), 'native')
    assert.equal(agentChatContextMenuKind({ isEditable: false, hasTextSelection: true }), 'native')
    assert.equal(agentChatContextMenuKind({ isEditable: false, hasTextSelection: false }), 'panel')
  })

  it('reads a live DOM selection', () => {
    assert.equal(hasDomTextSelection(() => null), false)
    assert.equal(hasDomTextSelection(() => ({
      isCollapsed: true,
      toString: () => '',
    } as Selection)), false)
    assert.equal(hasDomTextSelection(() => ({
      isCollapsed: false,
      toString: () => 'Ken Tune',
    } as Selection)), true)
  })
})
