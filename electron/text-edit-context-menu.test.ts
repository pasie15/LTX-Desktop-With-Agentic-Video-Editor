import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { editContextMenuTemplate } from './text-edit-context-menu.ts'

const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

describe('text edit context menu', () => {
  it('stays hidden when there is nothing to copy or edit', () => {
    assert.equal(editContextMenuTemplate({
      isEditable: false,
      selectionText: '',
      editFlags: flags,
    }), null)
  })

  it('offers copy for selected text and the full edit menu in a field', () => {
    const selected = editContextMenuTemplate({
      isEditable: false,
      selectionText: 'midnight',
      editFlags: flags,
    })
    assert.ok(selected)
    assert.equal(selected.some(item => item.role === 'copy' && item.enabled), true)
    assert.equal(selected.some(item => item.role === 'cut' && item.enabled), false)

    const field = editContextMenuTemplate({
      isEditable: true,
      selectionText: 'river',
      editFlags: flags,
    })
    assert.ok(field)
    assert.equal(field.some(item => item.role === 'cut' && item.enabled), true)
    assert.equal(field.some(item => item.role === 'paste' && item.enabled), true)
  })
})
