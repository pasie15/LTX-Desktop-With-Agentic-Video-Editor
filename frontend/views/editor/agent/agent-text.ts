import { TEXT_PRESETS } from '../../../types/project.ts'
import {
  DEFAULT_TEXT_STYLE,
  fontStyleValues,
  fontWeightValues,
  textAlignValues,
  type TextOverlayStyle,
} from '../../../types/project-model.ts'
import { AGENT_LYRIC_TRACK_INDEX, AGENT_OPENING_TITLE_DURATION_S, AGENT_TITLE_TRACK_INDEX } from './agent-mix.ts'

export const AGENT_TEXT_ROLES = [
  'title',
  'lyrics',
  'caption',
  'subtitle',
  'lower_third',
  'end_card',
  'corner',
  'shot_title',
] as const

export type AgentTextRole = (typeof AGENT_TEXT_ROLES)[number]

export const AGENT_SHOT_TITLE_DURATION_S = 2

export interface AgentTextOverlay {
  text: string
  role: AgentTextRole
  startTime: number
  duration: number
  style: Partial<TextOverlayStyle>
}

const ROLE_PRESET_ID: Record<AgentTextRole, string> = {
  title: 'centered-title',
  lyrics: 'lyrics',
  caption: 'subtitle-style',
  subtitle: 'subtitle-style',
  lower_third: 'lower-third-basic',
  end_card: 'end-card',
  corner: 'corner-tag',
  shot_title: 'shot-slug',
}

const ROLE_ALIASES: Record<string, AgentTextRole> = {
  title: 'title',
  opening: 'title',
  opening_title: 'title',
  'centered-title': 'title',
  headline: 'title',
  'big-bold': 'title',
  lyrics: 'lyrics',
  lyric: 'lyrics',
  song: 'lyrics',
  caption: 'caption',
  captions: 'caption',
  subtitle: 'subtitle',
  subtitles: 'subtitle',
  'subtitle-style': 'subtitle',
  lower_third: 'lower_third',
  lowerthird: 'lower_third',
  'lower-third': 'lower_third',
  'lower-third-basic': 'lower_third',
  name: 'lower_third',
  end_card: 'end_card',
  endcard: 'end_card',
  'end-card': 'end_card',
  thanks: 'end_card',
  corner: 'corner',
  'corner-tag': 'corner',
  tag: 'corner',
  shot_title: 'shot_title',
  shot: 'shot_title',
  slug: 'shot_title',
  'shot-slug': 'shot_title',
}

const LYRIC_TIME_PREFIX = /^\[(\d+(?:\.\d+)?)s?\]\s*/i
const LYRIC_TIME_SUFFIX = /\s*[\[(](\d+(?:\.\d+)?)s[\])]\s*$/i

export function parseTextRole(value: unknown): AgentTextRole | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ROLE_ALIASES[value.trim().toLowerCase()] ?? ROLE_ALIASES[key]
}

export function preferredTrackForTextRole(role: AgentTextRole): number {
  if (role === 'lyrics' || role === 'caption' || role === 'subtitle' || role === 'lower_third') {
    return AGENT_LYRIC_TRACK_INDEX
  }
  return AGENT_TITLE_TRACK_INDEX
}

export function defaultDurationForTextRole(role: AgentTextRole): number {
  if (role === 'title') return AGENT_OPENING_TITLE_DURATION_S
  if (role === 'shot_title') return AGENT_SHOT_TITLE_DURATION_S
  if (role === 'end_card') return 4
  if (role === 'corner') return 2
  return 4
}

export function styleForTextRole(
  role: AgentTextRole,
  text: string,
  overrides: Partial<TextOverlayStyle> = {},
): Partial<TextOverlayStyle> {
  const preset = TEXT_PRESETS.find(item => item.id === ROLE_PRESET_ID[role])
  return {
    ...DEFAULT_TEXT_STYLE,
    ...(preset?.style ?? {}),
    text,
    ...overrides,
  }
}

export function textStyleOverridesFromArgs(args: Record<string, unknown>): Partial<TextOverlayStyle> {
  const overrides: Partial<TextOverlayStyle> = {}
  if (typeof args.fontFamily === 'string' && args.fontFamily.trim()) {
    overrides.fontFamily = args.fontFamily.trim()
  }
  if (typeof args.fontSize === 'number' && Number.isFinite(args.fontSize)) {
    overrides.fontSize = clamp(args.fontSize, 12, 200)
  }
  if (typeof args.fontWeight === 'string' && (fontWeightValues as readonly string[]).includes(args.fontWeight)) {
    overrides.fontWeight = args.fontWeight as TextOverlayStyle['fontWeight']
  }
  if (typeof args.fontStyle === 'string' && (fontStyleValues as readonly string[]).includes(args.fontStyle)) {
    overrides.fontStyle = args.fontStyle as TextOverlayStyle['fontStyle']
  }
  if (typeof args.color === 'string' && args.color.trim()) overrides.color = args.color.trim()
  if (typeof args.backgroundColor === 'string' && args.backgroundColor.trim()) {
    overrides.backgroundColor = args.backgroundColor.trim()
  }
  if (typeof args.textAlign === 'string' && (textAlignValues as readonly string[]).includes(args.textAlign)) {
    overrides.textAlign = args.textAlign as TextOverlayStyle['textAlign']
  }
  if (typeof args.positionX === 'number' && Number.isFinite(args.positionX)) {
    overrides.positionX = clamp(args.positionX, 0, 100)
  }
  if (typeof args.positionY === 'number' && Number.isFinite(args.positionY)) {
    overrides.positionY = clamp(args.positionY, 0, 100)
  }
  if (typeof args.strokeColor === 'string' && args.strokeColor.trim()) {
    overrides.strokeColor = args.strokeColor.trim()
  }
  if (typeof args.strokeWidth === 'number' && Number.isFinite(args.strokeWidth)) {
    overrides.strokeWidth = clamp(args.strokeWidth, 0, 12)
  }
  if (typeof args.letterSpacing === 'number' && Number.isFinite(args.letterSpacing)) {
    overrides.letterSpacing = args.letterSpacing
  }
  if (typeof args.maxWidth === 'number' && Number.isFinite(args.maxWidth)) {
    overrides.maxWidth = clamp(args.maxWidth, 10, 100)
  }
  if (typeof args.opacity === 'number' && Number.isFinite(args.opacity)) {
    overrides.opacity = clamp(args.opacity, 0, 100)
  }
  return overrides
}

export function normalizeTextOverlays(raw: unknown): AgentTextOverlay[] {
  if (typeof raw === 'string') return parseLyricLines(raw)
  if (!Array.isArray(raw)) return []
  const overlays: AgentTextOverlay[] = []
  for (const [index, item] of raw.entries()) {
    if (typeof item === 'string' && item.trim()) {
      overlays.push(overlayFromLine(item, index))
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (!text) continue
    const role = parseTextRole(record.role) ?? parseTextRole(record.preset) ?? 'lyrics'
    const startTime = typeof record.startTime === 'number' && Number.isFinite(record.startTime)
      ? Math.max(0, record.startTime)
      : index * defaultDurationForTextRole(role)
    const duration = typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0
      ? record.duration
      : defaultDurationForTextRole(role)
    overlays.push({
      text,
      role,
      startTime,
      duration,
      style: textStyleOverridesFromArgs(record),
    })
  }
  return overlays
}

export function parseLyricLines(script: string): AgentTextOverlay[] {
  const lines = script.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.map((line, index) => overlayFromLine(line, index))
}

function overlayFromLine(raw: string, index: number): AgentTextOverlay {
  let text = raw
  let startTime = index * 4
  const prefix = text.match(LYRIC_TIME_PREFIX)
  if (prefix) {
    startTime = Number(prefix[1])
    text = text.replace(LYRIC_TIME_PREFIX, '').trim()
  }
  const suffix = text.match(LYRIC_TIME_SUFFIX)
  if (suffix) {
    startTime = Number(suffix[1])
    text = text.replace(LYRIC_TIME_SUFFIX, '').trim()
  }
  return {
    text: text || raw,
    role: 'lyrics',
    startTime,
    duration: 4,
    style: {},
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
