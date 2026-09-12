import type { Asset } from '../../types/project-model'
import { addGenericAssetToProject, addVisualAssetToProject } from '../../lib/asset-copy'
import { pathToFileUrl } from '../../lib/file-url'

export const IMPORTED_MEDIA_TYPES = ['image', 'video', 'audio'] as const
export type ImportedMediaType = (typeof IMPORTED_MEDIA_TYPES)[number]

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mxf', 'r3d', 'braw', 'ari', 'm4v']
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'aiff', 'aif']
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'gif', 'webp', 'exr', 'dpx', 'psd']

export function detectImportedMediaType(input: {
  name?: string
  path?: string
  mimeType?: string
  type?: string
}): ImportedMediaType | null {
  const explicit = input.type?.trim().toLowerCase()
  if (explicit === 'image' || explicit === 'video' || explicit === 'audio') return explicit
  const mime = input.mimeType?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const leaf = (input.path || input.name || '').split(/[\\/]/).pop() ?? ''
  const ext = leaf.includes('.') ? leaf.split('.').pop()?.toLowerCase() ?? '' : ''
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  return null
}

export function createImportedAssetId(now = Date.now()): string {
  return `asset-${now}-${Math.random().toString(36).slice(2, 11)}`
}

export function probeHtmlMediaDuration(url: string, isAudio: boolean): Promise<number> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') {
      resolve(5)
      return
    }
    const media = document.createElement(isAudio ? 'audio' : 'video')
    media.src = url
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 5)
    media.onerror = () => resolve(5)
  })
}

export interface ImportLocalMediaCopyFns {
  copyVisual: (
    srcPath: string,
    projectId: string,
    type: 'video' | 'image',
  ) => Promise<{
    path: string
    bigThumbnailPath: string
    smallThumbnailPath: string
    width: number
    height: number
  } | null>
  copyGeneric: (srcPath: string, projectId: string) => Promise<{ path: string } | null>
  probeDuration: (url: string, isAudio: boolean) => Promise<number>
  now?: () => number
  createId?: () => string
}

export const defaultImportLocalMediaCopyFns: ImportLocalMediaCopyFns = {
  copyVisual: addVisualAssetToProject,
  copyGeneric: addGenericAssetToProject,
  probeDuration: probeHtmlMediaDuration,
}

export async function importLocalMediaPath(input: {
  srcPath: string
  projectId: string
  displayName?: string
  mimeType?: string
  type?: ImportedMediaType
  copy?: ImportLocalMediaCopyFns
}): Promise<Asset | null> {
  const type = detectImportedMediaType({
    path: input.srcPath,
    name: input.displayName,
    mimeType: input.mimeType,
    type: input.type,
  })
  if (!type) return null
  return finalizeImportedAsset({
    srcPath: input.srcPath,
    projectId: input.projectId,
    displayName: input.displayName?.trim() || leafName(input.srcPath) || type,
    type,
    probeUrl: pathToFileUrl(input.srcPath),
    copy: input.copy ?? defaultImportLocalMediaCopyFns,
  })
}

export async function importLocalMediaFile(input: {
  file: File
  projectId: string
  srcPath?: string | null
  copy?: ImportLocalMediaCopyFns
}): Promise<Asset | null> {
  const type = detectImportedMediaType({
    name: input.file.name,
    path: input.srcPath ?? input.file.name,
    mimeType: input.file.type,
  })
  if (!type) return null
  const srcPath = input.srcPath?.trim() || null
  const probeUrl = srcPath ? pathToFileUrl(srcPath) : URL.createObjectURL(input.file)
  try {
    return await finalizeImportedAsset({
      srcPath: srcPath ?? input.file.name,
      projectId: input.projectId,
      displayName: input.file.name,
      type,
      probeUrl,
      copy: input.copy ?? defaultImportLocalMediaCopyFns,
      skipCopy: !srcPath,
    })
  } finally {
    if (!srcPath) URL.revokeObjectURL(probeUrl)
  }
}

async function finalizeImportedAsset(input: {
  srcPath: string
  projectId: string
  displayName: string
  type: ImportedMediaType
  probeUrl: string
  copy: ImportLocalMediaCopyFns
  skipCopy?: boolean
}): Promise<Asset | null> {
  let persistentPath = input.srcPath
  let bigThumbnailPath: string | undefined
  let smallThumbnailPath: string | undefined
  let width: number | undefined
  let height: number | undefined
  let duration = 5

  if (input.type === 'video' || input.type === 'audio') {
    duration = await input.copy.probeDuration(input.probeUrl, input.type === 'audio')
  }

  if (!input.skipCopy) {
    if (input.type === 'video' || input.type === 'image') {
      const copied = await input.copy.copyVisual(input.srcPath, input.projectId, input.type)
      if (!copied) return null
      persistentPath = copied.path
      bigThumbnailPath = copied.bigThumbnailPath
      smallThumbnailPath = copied.smallThumbnailPath
      width = copied.width
      height = copied.height
    } else {
      const copied = await input.copy.copyGeneric(input.srcPath, input.projectId)
      if (copied?.path) persistentPath = copied.path
    }
  }

  const now = input.copy.now?.() ?? Date.now()
  return {
    id: input.copy.createId?.() ?? createImportedAssetId(now),
    type: input.type,
    path: persistentPath,
    bigThumbnailPath,
    smallThumbnailPath,
    width,
    height,
    prompt: `Imported: ${input.displayName}`,
    resolution: 'imported',
    duration,
    createdAt: now,
  }
}

function leafName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
