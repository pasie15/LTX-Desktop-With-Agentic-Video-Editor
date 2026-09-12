import { useCallback, useRef } from 'react'
import { useEditorActions } from './editor-store'
import { defaultImportLocalMediaCopyFns } from './import-local-media-defaults'
import { importLocalMediaFile } from './import-local-media'

interface UseEditorMediaImportParams {
  currentProjectId: string | null
}

export function useEditorMediaImport(params: UseEditorMediaImportParams) {
  const { currentProjectId } = params
  const { addAssetToEditor } = useEditorActions()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !currentProjectId) return

    for (const file of Array.from(files)) {
      const srcPath = window.electronAPI?.getPathForFile(file) ?? null
      const asset = await importLocalMediaFile({
        file,
        projectId: currentProjectId,
        srcPath,
        copy: defaultImportLocalMediaCopyFns,
      })
      if (asset) addAssetToEditor(asset)
    }

    e.target.value = ''
    if (fileInputRef.current && fileInputRef.current !== e.target) {
      fileInputRef.current.value = ''
    }
  }, [addAssetToEditor, currentProjectId])

  return {
    fileInputRef,
    handleImportFile,
  }
}
