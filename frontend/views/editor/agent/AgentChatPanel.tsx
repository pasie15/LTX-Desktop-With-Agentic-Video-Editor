import { useCallback, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { ChevronRight, MessageSquare, Send, Square, X } from 'lucide-react'
import { AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL } from '../../../lib/agent-llm'
import { useAppSettings } from '../../../contexts/AppSettingsContext'
import { useGlobalGenerationLock } from '../../../hooks/use-global-generation-lock'
import { Tooltip } from '../../../components/ui/tooltip'
import {
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectAssets,
  selectSelectedClipIds,
  selectSelectedGap,
} from '../editor-selectors'
import { useEditorActions, useEditorGetState, useEditorStore } from '../editor-store'
import type { TimelineGapSelection } from '../editor-state'
import { AGENT_STARTER_PROMPTS, resolveStarterComposerText, shouldAutoSendStarter, type AgentStarterPrompt } from './agent-starters'
import { AgentAskUserCards } from './AgentAskUserCards'
import { AgentMentionPopover, buildMentionOptions } from './AgentMentionPopover'
import { AgentMessageList } from './AgentMessageList'
import { AgentTabBar } from './AgentTabBar'
import {
  filterAssetsForMention,
  findMentionQuery,
  mentionChipLabel,
  mentionFromAsset,
  mentionFromRange,
  mentionFromSelection,
  replaceMentionQuery,
} from './agent-mentions'
import { useAgentChat } from './use-agent-chat'
import { defaultImportLocalMediaCopyFns } from '../import-local-media-defaults'
import { importLocalMediaFile } from '../import-local-media'
import type { AgentMention } from './agent-types'

export interface AgentChatPanelProps {
  projectId: string
  projectName: string
  getSelectedGap?: () => TimelineGapSelection | null
}

const COMPOSER_PLACEHOLDER = 'Ask, or type @ to reference media'

function openAgentLlmSettings(): void {
  window.dispatchEvent(new CustomEvent('open-settings', {
    detail: AGENT_LLM_KEY_REQUIRED_SETTINGS_DETAIL,
  }))
}

export function AgentChatPanel(props: AgentChatPanelProps) {
  const actions = useEditorActions()
  const getEditorState = useEditorGetState()
  const { settings, shouldVideoGenerateWithLtxApi, shouldImageGenerateWithFalApi } = useAppSettings()
  const generationLock = useGlobalGenerationLock()
  const hasAgentLlmKey = settings.hasAgentLlmKey
  const storeSelectedGap = useEditorStore(selectSelectedGap)
  const assets = useEditorStore(selectAssets)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const inPoint = useEditorStore(selectActiveTimelineInPoint)
  const outPoint = useEditorStore(selectActiveTimelineOutPoint)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [caret, setCaret] = useState(0)

  const readSelectedGap = useCallback(() => {
    return props.getSelectedGap?.() ?? storeSelectedGap
  }, [props.getSelectedGap, storeSelectedGap])

  const chat = useAgentChat({
    projectId: props.projectId,
    projectName: props.projectName,
    getEditorState,
    getSelectedGap: readSelectedGap,
    assets,
    generationBusy: generationLock.isRunning,
    generationCanCancel: generationLock.canCancel,
    currentModelLabel: 'fast',
    hasAgentLlmKey,
    shouldVideoGenerateWithLtxApi,
    shouldImageGenerateWithFalApi,
  })

  const mentionQuery = findMentionQuery(chat.draft, caret)
  const mentionOptions = useMemo(() => {
    if (!mentionQuery) return []
    return buildMentionOptions({
      assets,
      query: mentionQuery.query,
      selectedClipIds: [...selectedClipIds],
      inPoint,
      outPoint,
      mentionFromAsset,
      mentionFromSelection,
      mentionFromRange,
      filterAssets: filterAssetsForMention,
    })
  }, [assets, inPoint, mentionQuery, outPoint, selectedClipIds])

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const attachMention = useCallback((mention: AgentMention) => {
    chat.setMentions(prev => prev.some(item => item.id === mention.id) ? prev : [...prev, mention])
    if (mentionQuery) {
      const next = replaceMentionQuery(chat.draft, caret, '')
      chat.setDraft(next.text)
      setCaret(next.caret)
    }
    focusComposer()
  }, [caret, chat, focusComposer, mentionQuery])

  const handleSend = useCallback((text?: string) => {
    if (!hasAgentLlmKey) {
      openAgentLlmSettings()
      return
    }
    void chat.sendText(text ?? chat.draft)
  }, [chat, hasAgentLlmKey])

  const applyStarter = useCallback((starter: AgentStarterPrompt) => {
    const nextDraft = resolveStarterComposerText(starter)
    chat.setDraft(nextDraft)
    focusComposer()
    if (shouldAutoSendStarter(starter, readSelectedGap() !== null)) {
      handleSend(nextDraft)
    }
  }, [chat, focusComposer, handleSend, readSelectedGap])

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionActiveIndex(index => (index + 1) % mentionOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionActiveIndex(index => (index - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const option = mentionOptions[mentionActiveIndex] ?? mentionOptions[0]
        if (option) attachMention(option.mention)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        const next = replaceMentionQuery(chat.draft, caret, '')
        chat.setDraft(next.text)
        return
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (chat.running) return
    handleSend()
  }, [attachMention, caret, chat, handleSend, mentionActiveIndex, mentionOptions])

  const importDroppedFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const srcPath = window.electronAPI?.getPathForFile(file) ?? null
      if (!srcPath) continue
      const asset = await importLocalMediaFile({
        file,
        projectId: props.projectId,
        srcPath,
        copy: defaultImportLocalMediaCopyFns,
      })
      if (!asset) continue
      actions.addAssetToEditor(asset)
      attachMention({ ...mentionFromAsset(asset), label: file.name })
    }
  }, [actions, attachMention, props.projectId])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    void importDroppedFiles(files)
  }, [importDroppedFiles])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    void importDroppedFiles(files)
  }, [importDroppedFiles])

  const messages = chat.activeSession?.messages ?? []
  const showEmpty = hasAgentLlmKey && messages.length === 0 && !chat.running

  return (
    <div className="relative h-full group" onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
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

        {hasAgentLlmKey && (
          <AgentTabBar
            sessions={chat.sessions}
            openSessionIds={chat.openSessionIds}
            activeSessionId={chat.activeSessionId}
            historyOpen={historyOpen}
            onToggleHistory={() => setHistoryOpen(open => !open)}
            onNewChat={chat.createSession}
            onOpenSession={chat.openSession}
            onCloseTab={chat.closeTab}
            onDeleteSession={chat.deleteSession}
          />
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
          {!hasAgentLlmKey ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-2">
              <MessageSquare className="h-6 w-6 text-zinc-600" />
              <p className="text-[12px] text-zinc-400 leading-relaxed">
                Add an Agent API key in Settings to use chat.
              </p>
              <button
                type="button"
                onClick={openAgentLlmSettings}
                className="text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                Add an Agent API key in Settings
              </button>
            </div>
          ) : showEmpty ? (
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
            <AgentMessageList
              messages={messages}
              running={chat.running}
              generationProgress={chat.generationProgress}
            />
          )}
        </div>

        {chat.askUser && (
          <AgentAskUserCards questions={chat.askUser} disabled={chat.running} onSubmit={chat.answerAskUser} />
        )}

        {chat.mentions.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {chat.mentions.map(mention => (
              <span
                key={mention.id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300"
              >
                @{mentionChipLabel(mention)}
                <button
                  type="button"
                  onClick={() => chat.setMentions(prev => prev.filter(item => item.id !== mention.id))}
                  className="text-zinc-500 hover:text-white"
                  aria-label={`Remove ${mention.label}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-shrink-0 border-t border-zinc-800 p-2">
          <div className="relative flex items-end gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 focus-within:border-zinc-600">
            {mentionQuery && (
              <AgentMentionPopover
                options={mentionOptions}
                activeIndex={mentionActiveIndex}
                onSelect={option => attachMention(option.mention)}
              />
            )}
            <textarea
              ref={composerRef}
              value={chat.draft}
              onChange={event => {
                chat.setDraft(event.target.value)
                setCaret(event.target.selectionStart)
                setMentionActiveIndex(0)
              }}
              onSelect={event => setCaret(event.currentTarget.selectionStart)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handlePaste}
              placeholder={COMPOSER_PLACEHOLDER}
              rows={3}
              className="flex-1 min-w-0 resize-none bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-600 outline-none leading-5"
            />
            {chat.running ? (
              <button
                type="button"
                onClick={chat.stop}
                className="flex-shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Stop"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!chat.draft.trim() && chat.mentions.length === 0}
                className="flex-shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
