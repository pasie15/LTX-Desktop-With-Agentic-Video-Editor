import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from 'electron'

export function editContextMenuTemplate(
  params: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>,
): MenuItemConstructorOptions[] | null {
  const hasSelection = Boolean(params.selectionText?.trim())
  if (!params.isEditable && !hasSelection) return null
  return [
    { role: 'cut', enabled: params.isEditable && params.editFlags.canCut },
    { role: 'copy', enabled: hasSelection || params.editFlags.canCopy },
    { role: 'paste', enabled: params.isEditable && params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: params.isEditable || hasSelection },
  ]
}

export function attachTextEditContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = editContextMenuTemplate(params)
    if (!template) return
    void import('electron').then(({ Menu }) => {
      Menu.buildFromTemplate(template).popup({ window })
    })
  })
}
