import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight, MessageSquare, Send } from 'lucide-react'
import { GEMINI_KEY_REQUIRED_SETTINGS_DETAIL } from '../../../lib/enhance-gemini-key'
import { useAppSettings } from '../../../contexts/AppSettingsContext'
import { Tooltip } from '../../../components/ui/tooltip'
import { selectSelectedGap } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'
import type { TimelineGapSelection } from '../editor-state'
import {
  AGENT_STARTER_PROMPTS,
  resolveStarterComposerText,
  shouldAutoSendStarter,
  type AgentStarterPrompt,
} from './agent-starters'

export interface AgentChatPanelProps {
  getSelectedGap?: () => TimelineGapSelection | null
}

const COMPOSER_PLACEHOLDER = 'Ask, or type @ to reference media'

function openGeminiSettings(): void {
  window.dispatchEvent(new CustomEvent('open-settings', {
    detail: GEMINI_KEY_REQUIRED_SETTINGS_DETAIL,
  }))
}

export function AgentChatPanel(props: AgentChatPanelProps) {
  const actions = useEditorActions()
  const { settings } = useAppSettings()
  const hasGeminiApiKey = settings.hasGeminiApiKey
  const storeSelectedGap = useEditorStore(selectSelectedGap)
  const [draft, setDraft] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const readSelectedGap = useCallback(() => {
    return props.getSelectedGap?.() ?? storeSelectedGap
  }, [props.getSelectedGap, storeSelectedGap])

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const handleSend = useCallback(() => {
    if (!hasGeminiApiKey) {
      openGeminiSettings()
      return
    }
    // Phase 1 chrome only — the agent loop lands in a later PR.
  }, [hasGeminiApiKey])

  const applyStarter = useCallback((starter: AgentStarterPrompt) => {
    const nextDraft = resolveStarterComposerText(starter)
    setDraft(nextDraft)
    focusComposer()
    if (shouldAutoSendStarter(starter, readSelectedGap() !== null)) {
      handleSend()
    }
  }, [focusComposer, handleSend, readSelectedGap])

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    handleSend()
  }, [handleSend])

  return (
    <div className="relative h-full group">
      <Tooltip content="Collapse Agent" side="left">
        <button
          type="button"
          className="absolute top-1/2 -translate-y-1/2 -left-3 w-6 h-8 bg-zinc-800 border border-zinc-700 rounded-l-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100 z-20 cursor-pointer"
          onClick={() => actions.setShowAgentChat(false)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      <div className="h-full bg-zinc-950 border-l border-zinc-800 flex flex-col min-w-0">
        <div className="h-8 px-3 border-b border-zinc-800 flex items-center gap-2 flex-shrink-0">
          <MessageSquare className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[11px] font-semibold text-zinc-400 tracking-wide">Agent</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
          {hasGeminiApiKey ? (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] text-zinc-400">Ask anything, or start with:</p>
              <div className="flex flex-col gap-1.5">
                {AGENT_STARTER_PROMPTS.map(starter => (
                  <button
                    key={starter.id}
                    type="button"
                    onClick={() => applyStarter(starter)}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] text-zinc-300 bg-zinc-900 hover:bg-zinc-800 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-2">
              <MessageSquare className="h-6 w-6 text-zinc-600" />
              <p className="text-[12px] text-zinc-400 leading-relaxed">
                Add a Gemini API key in Settings to use Agent.
              </p>
              <button
                type="button"
                onClick={openGeminiSettings}
                className="text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                Add a Gemini API key in Settings
              </button>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-zinc-800 p-2">
          <div className="flex items-end gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 focus-within:border-zinc-600">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={COMPOSER_PLACEHOLDER}
              rows={3}
              className="flex-1 min-w-0 resize-none bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-600 outline-none leading-5"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim()}
              className="flex-shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
