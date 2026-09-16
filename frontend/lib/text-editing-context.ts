import type { ActionId } from './keyboard-shortcuts.ts'

export const AGENT_CHAT_ATTR = 'data-agent-chat'
export const AGENT_COPY_ATTR = 'data-agent-copy'

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'hidden',
  'range',
  'color',
  'image',
])

function isDomElement(target: EventTarget | null): target is Element {
  return typeof Element !== 'undefined' && target instanceof Element
}

/** Input, textarea, or contenteditable — browser owns copy/cut/paste here. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!isDomElement(target)) return false
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly
  if (target instanceof HTMLInputElement) {
    if (target.disabled || target.readOnly) return false
    return !NON_TEXT_INPUT_TYPES.has(target.type)
  }
  if (target instanceof HTMLSelectElement) return !target.disabled
  return target instanceof HTMLElement && target.isContentEditable
}

export function isInsideAgentChat(target: EventTarget | null): boolean {
  return isDomElement(target) && target.closest(`[${AGENT_CHAT_ATTR}]`) !== null
}

export function hasDomTextSelection(
  getSelection: () => Selection | null = defaultGetSelection,
): boolean {
  const selection = getSelection()
  if (!selection || selection.isCollapsed) return false
  return selection.toString().length > 0
}

function defaultGetSelection(): Selection | null {
  return typeof window === 'undefined' ? null : window.getSelection()
}

export type AgentChatContextMenuKind = 'native' | 'panel'

/** Native Electron menu when a field or selection can copy; React menu otherwise. */
export function agentChatContextMenuKind(input: {
  isEditable: boolean
  hasTextSelection: boolean
}): AgentChatContextMenuKind {
  if (input.isEditable || input.hasTextSelection) return 'native'
  return 'panel'
}

export function copyableTextFromTarget(target: EventTarget | null): string {
  if (!isDomElement(target)) return ''
  return target.closest(`[${AGENT_COPY_ATTR}]`)?.textContent?.trim() ?? ''
}

export function selectElementText(element: Element | null): void {
  if (!element || typeof window === 'undefined') return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

export interface ShouldIgnoreEditorShortcutOptions {
  hasTextSelection?: boolean
  isEditable?: boolean
  insideAgentChat?: boolean
}

/** Leave clipboard / typing to the agent panel and any selected text. */
export function shouldIgnoreEditorShortcut(
  event: Pick<KeyboardEvent, 'target'>,
  action: ActionId,
  options?: ShouldIgnoreEditorShortcutOptions,
): boolean {
  if (action === 'view.agentChat') return false
  const editable = options?.isEditable ?? isEditableKeyboardTarget(event.target)
  const insideAgent = options?.insideAgentChat ?? isInsideAgentChat(event.target)
  if (editable || insideAgent) return true
  if (
    (action === 'edit.copy' || action === 'edit.cut' || action === 'edit.selectAll')
    && (options?.hasTextSelection ?? hasDomTextSelection())
  ) {
    return true
  }
  return false
}
