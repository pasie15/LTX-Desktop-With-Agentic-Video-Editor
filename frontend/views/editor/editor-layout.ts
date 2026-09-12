export const LAYOUT_STORAGE_KEY = 'ltx-video-editor-layout'

export interface EditorLayout {
  leftPanelWidth: number   // px
  rightPanelWidth: number  // px
  timelineHeight: number   // px
  assetsHeight: number     // px – height of assets section in left panel (timelines gets the rest)
  chatPanelWidth: number   // px – Agent chat column
}

export const DEFAULT_LAYOUT: EditorLayout = {
  leftPanelWidth: 288,   // w-72
  rightPanelWidth: 256,   // w-64
  timelineHeight: 224,    // h-56
  assetsHeight: 0,        // 0 = auto (use flex proportions)
  chatPanelWidth: 360,
}

export const LAYOUT_LIMITS = {
  leftPanelWidth:  { min: 180, max: 480 },
  rightPanelWidth: { min: 200, max: 480 },
  timelineHeight:  { min: 120, max: 600 },
  assetsHeight:    { min: 120, max: 800 },
  chatPanelWidth:  { min: 280, max: 480 },
}

/** Below this viewport width, opening Agent collapses Properties so both right columns do not crowd the timeline. */
export const AGENT_CHAT_NARROW_VIEWPORT_PX = 1400

export function shouldCollapsePropertiesForAgentChat(viewportWidth: number): boolean {
  return viewportWidth < AGENT_CHAT_NARROW_VIEWPORT_PX
}

export function clampVal(val: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, val))
}

export function normalizeEditorLayout(parsed: Partial<EditorLayout> | null | undefined): EditorLayout {
  return {
    leftPanelWidth: clampVal(parsed?.leftPanelWidth ?? DEFAULT_LAYOUT.leftPanelWidth, LAYOUT_LIMITS.leftPanelWidth),
    rightPanelWidth: clampVal(parsed?.rightPanelWidth ?? DEFAULT_LAYOUT.rightPanelWidth, LAYOUT_LIMITS.rightPanelWidth),
    timelineHeight: clampVal(parsed?.timelineHeight ?? DEFAULT_LAYOUT.timelineHeight, LAYOUT_LIMITS.timelineHeight),
    assetsHeight: parsed?.assetsHeight ? clampVal(parsed.assetsHeight, LAYOUT_LIMITS.assetsHeight) : 0,
    chatPanelWidth: clampVal(parsed?.chatPanelWidth ?? DEFAULT_LAYOUT.chatPanelWidth, LAYOUT_LIMITS.chatPanelWidth),
  }
}

export function loadLayout(): EditorLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (stored) {
      return normalizeEditorLayout(JSON.parse(stored) as Partial<EditorLayout>)
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_LAYOUT }
}

export function saveLayout(layout: EditorLayout) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch { /* ignore */ }
}

export const LAYOUT_PRESETS_KEY = 'ltx-video-editor-layout-presets'

export interface LayoutPreset {
  id: string
  name: string
  layout: EditorLayout
}

export function loadLayoutPresets(): LayoutPreset[] {
  try {
    const stored = localStorage.getItem(LAYOUT_PRESETS_KEY)
    if (stored) return JSON.parse(stored) as LayoutPreset[]
  } catch { /* ignore */ }
  return []
}

export function saveLayoutPresets(presets: LayoutPreset[]) {
  try { localStorage.setItem(LAYOUT_PRESETS_KEY, JSON.stringify(presets)) } catch { /* ignore */ }
}
