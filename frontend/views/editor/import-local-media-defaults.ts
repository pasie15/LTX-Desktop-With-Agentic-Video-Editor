import { addGenericAssetToProject, addVisualAssetToProject } from '../../lib/asset-copy'
import {
  probeHtmlMediaDuration,
  type ImportLocalMediaCopyFns,
} from './import-local-media'

export const defaultImportLocalMediaCopyFns: ImportLocalMediaCopyFns = {
  copyVisual: addVisualAssetToProject,
  copyGeneric: addGenericAssetToProject,
  probeDuration: probeHtmlMediaDuration,
}
