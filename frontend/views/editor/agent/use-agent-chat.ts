import { useCallback, useEffect, useRef, useState } from 'react'
import type { Asset } from '../../../types/project-model'
import type { EditorState, TimelineGapSelection } from '../editor-state'
import { useEditorApply } from '../editor-store'
import { addVisualAssetToProject } from '../../../lib/asset-copy'
import { AGENT_INSTRUCTIONS } from './agent-instructions'
import { requestAgentTurn } from './agent-api'
import { createAgentGenerationJobs } from './agent-generation-jobs'
import { answersToUserMessage, runAgentLoop } from './agent-loop'
import { mentionPartsForMessage } from './agent-mentions'
import { getAgentChatStorage, loadAgentSessions } from './agent-persistence'
import { buildAgentSnapshot } from './agent-snapshot'
import { AGENT_TOOL_DEFINITIONS, isGenerateToolName } from './tool-definitions'
import { createAgentToolExecutor, executeAgentTool } from './tool-executor'
import {
  AGENT_ADD_MENTION_EVENT,
  createAgentMessageId,
  createAgentSessionId,
  isAgentAddMentionEvent,
  titleFromMessages,
  type AgentAskUserQuestion,
  type AgentChatMessage,
  type AgentChatSession,
  type AgentGenerationProgress,
  type AgentMention,
} from './agent-types'

const PERSIST_DEBOUNCE_MS = 300

export interface UseAgentChatParams {
  projectId: string
  projectName: string
  getEditorState: () => EditorState
  getSelectedGap?: () => TimelineGapSelection | null
  assets: Asset[]
  generationBusy: boolean
  generationCanCancel: boolean
  currentModelLabel: string
  hasGeminiApiKey: boolean
  shouldVideoGenerateWithLtxApi: boolean
  shouldImageGenerateWithFalApi: boolean
}

export function useAgentChat(params: UseAgentChatParams) {
  const {
    projectId,
    projectName,
    getEditorState,
    getSelectedGap,
    assets,
    generationBusy,
    generationCanCancel,
    currentModelLabel,
    hasGeminiApiKey,
    shouldVideoGenerateWithLtxApi,
    shouldImageGenerateWithFalApi,
  } = params

  const [sessions, setSessions] = useState<AgentChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [openSessionIds, setOpenSessionIds] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<AgentMention[]>([])
  const [running, setRunning] = useState(false)
  const [askUser, setAskUser] = useState<AgentAskUserQuestion[] | null>(null)
  const [generationProgress, setGenerationProgress] = useState<AgentGenerationProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const { applyWithHistory, applyWithoutHistory } = useEditorApply()
  const generationBusyRef = useRef(generationBusy)
  generationBusyRef.current = generationBusy
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const apiFlagsRef = useRef({ shouldVideoGenerateWithLtxApi, shouldImageGenerateWithFalApi })
  apiFlagsRef.current = { shouldVideoGenerateWithLtxApi, shouldImageGenerateWithFalApi }
  const executorHostRef = useRef({
    getState: getEditorState,
    applyWithHistory,
    applyWithoutHistory,
    getSelectedGap,
    getAbortSignal: () => abortRef.current?.signal ?? null,
    onProgress: (progress: AgentGenerationProgress) => setGenerationProgress(progress),
  })
  executorHostRef.current.getState = getEditorState
  executorHostRef.current.applyWithHistory = applyWithHistory
  executorHostRef.current.applyWithoutHistory = applyWithoutHistory
  executorHostRef.current.getSelectedGap = getSelectedGap
  const generationJobsRef = useRef<ReturnType<typeof createAgentGenerationJobs> | null>(null)
  if (!generationJobsRef.current) {
    generationJobsRef.current = createAgentGenerationJobs({
      projectId,
      isBusy: () => generationBusyRef.current,
      persistVisualAsset: (srcPath, type) => addVisualAssetToProject(srcPath, projectIdRef.current, type),
      shouldVideoGenerateWithLtxApi: apiFlagsRef.current.shouldVideoGenerateWithLtxApi,
      shouldImageGenerateWithFalApi: apiFlagsRef.current.shouldImageGenerateWithFalApi,
    })
  }
  const executorRef = useRef<ReturnType<typeof createAgentToolExecutor> | null>(null)
  if (!executorRef.current) {
    executorRef.current = createAgentToolExecutor({
      getState: () => executorHostRef.current.getState(),
      applyWithHistory: fn => executorHostRef.current.applyWithHistory(fn),
      applyWithoutHistory: fn => executorHostRef.current.applyWithoutHistory(fn),
      generation: generationJobsRef.current,
      getSelectedGap: () => executorHostRef.current.getSelectedGap?.() ?? null,
      projectId,
      getAbortSignal: () => executorHostRef.current.getAbortSignal(),
      onProgress: progress => executorHostRef.current.onProgress(progress),
    })
  }
  executorRef.current.host.generation = generationJobsRef.current
  executorRef.current.host.getSelectedGap = () => executorHostRef.current.getSelectedGap?.() ?? null
  executorRef.current.host.projectId = projectId
  executorRef.current.host.getAbortSignal = () => executorHostRef.current.getAbortSignal()
  executorRef.current.host.onProgress = progress => executorHostRef.current.onProgress(progress)

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null

  const persistSession = useCallback((session: AgentChatSession) => {
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      void getAgentChatStorage().write(projectId, session).catch(() => {})
    }, PERSIST_DEBOUNCE_MS)
  }, [projectId])

  const replaceSession = useCallback((next: AgentChatSession) => {
    const titled: AgentChatSession = {
      ...next,
      title: next.title === 'New chat' ? titleFromMessages(next.messages) : next.title,
      updatedAt: Date.now(),
    }
    setSessions(prev => {
      const without = prev.filter(session => session.id !== titled.id)
      return [titled, ...without]
    })
    persistSession(titled)
  }, [persistSession])

  useEffect(() => {
    executorRef.current?.resetAssistantUndo()
    generationJobsRef.current = createAgentGenerationJobs({
      projectId,
      isBusy: () => generationBusyRef.current,
      persistVisualAsset: (srcPath, type) => addVisualAssetToProject(srcPath, projectIdRef.current, type),
      shouldVideoGenerateWithLtxApi: apiFlagsRef.current.shouldVideoGenerateWithLtxApi,
      shouldImageGenerateWithFalApi: apiFlagsRef.current.shouldImageGenerateWithFalApi,
    })
    if (executorRef.current) executorRef.current.host.generation = generationJobsRef.current
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void loadAgentSessions(projectId).then(loaded => {
      if (cancelled) return
      if (loaded.length === 0) {
        const fresh: AgentChatSession = {
          id: createAgentSessionId(),
          title: 'New chat',
          updatedAt: Date.now(),
          messages: [],
        }
        setSessions([fresh])
        setActiveSessionId(fresh.id)
        setOpenSessionIds([fresh.id])
        return
      }
      setSessions(loaded)
      setActiveSessionId(loaded[0].id)
      setOpenSessionIds([loaded[0].id])
    }).catch(() => {
      if (cancelled) return
      const fresh: AgentChatSession = {
        id: createAgentSessionId(),
        title: 'New chat',
        updatedAt: Date.now(),
        messages: [],
      }
      setSessions([fresh])
      setActiveSessionId(fresh.id)
      setOpenSessionIds([fresh.id])
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const handler = (event: Event) => {
      if (!isAgentAddMentionEvent(event)) return
      const mention = event.detail.mention
      setMentions(prev => prev.some(item => item.id === mention.id) ? prev : [...prev, mention])
    }
    window.addEventListener(AGENT_ADD_MENTION_EVENT, handler)
    return () => window.removeEventListener(AGENT_ADD_MENTION_EVENT, handler)
  }, [])

  const createSession = useCallback(() => {
    const fresh: AgentChatSession = {
      id: createAgentSessionId(),
      title: 'New chat',
      updatedAt: Date.now(),
      messages: [],
    }
    setSessions(prev => [fresh, ...prev])
    setActiveSessionId(fresh.id)
    setOpenSessionIds(prev => prev.includes(fresh.id) ? prev : [...prev, fresh.id])
    setDraft('')
    setMentions([])
    setAskUser(null)
    persistSession(fresh)
  }, [persistSession])

  const openSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    setOpenSessionIds(prev => prev.includes(sessionId) ? prev : [...prev, sessionId])
    setAskUser(null)
  }, [])

  const closeTab = useCallback((sessionId: string) => {
    setOpenSessionIds(prev => {
      const next = prev.filter(id => id !== sessionId)
      if (sessionId === activeSessionId) {
        setActiveSessionId(next[0] ?? sessionsRef.current.find(session => session.id !== sessionId)?.id ?? null)
      }
      return next
    })
  }, [activeSessionId])

  const deleteSession = useCallback((sessionId: string) => {
    void getAgentChatStorage().remove(projectId, sessionId).catch(() => {})
    setSessions(prev => prev.filter(session => session.id !== sessionId))
    closeTab(sessionId)
    if (sessionsRef.current.filter(session => session.id !== sessionId).length === 0) {
      createSession()
    }
  }, [closeTab, createSession, projectId])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    generationJobsRef.current?.cancel()
  }, [])

  const runLoop = useCallback(async (seed: AgentChatSession) => {
    setAskUser(null)
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    let latest = seed.messages
    try {
      const result = await runAgentLoop({
        getMessages: () => latest,
        getProjectContext: () => buildAgentSnapshot({
          state: getEditorState(),
          projectId,
          projectName,
          generationBusy,
          generationCanCancel,
          currentModelLabel,
          selectedGapOverride: getSelectedGap?.() ?? null,
        }) as unknown as Record<string, unknown>,
        availableTools: generationBusy
          ? AGENT_TOOL_DEFINITIONS.filter(tool => !isGenerateToolName(tool.name))
          : AGENT_TOOL_DEFINITIONS,
        skills: AGENT_INSTRUCTIONS,
        requestTurn: requestAgentTurn,
        executeTool: (name, args) => executeAgentTool(executorRef.current!, name, args),
        onMessages: (messages) => {
          latest = messages
          replaceSession({ ...seed, messages })
        },
        onAskUser: setAskUser,
        signal: controller.signal,
      })
      replaceSession({ ...seed, messages: result.messages })
    } finally {
      setRunning(false)
      setGenerationProgress(null)
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [
    currentModelLabel,
    generationBusy,
    generationCanCancel,
    getEditorState,
    getSelectedGap,
    projectId,
    projectName,
    replaceSession,
  ])

  const sendText = useCallback(async (text: string, extraMentions: AgentMention[] = []) => {
    const content = text.trim()
    const attached = [...mentions, ...extraMentions]
    if (!content && attached.length === 0) return
    if (!hasGeminiApiKey || !activeSession) return

    const mentionParts = await mentionPartsForMessage(
      attached,
      assets,
      window.electronAPI?.readLocalFile
        ? async (filePath) => window.electronAPI.readLocalFile({ filePath })
        : undefined,
    )
    const userMessage: AgentChatMessage = {
      id: createAgentMessageId(),
      role: 'user',
      createdAt: Date.now(),
      parts: [
        ...(content ? [{ type: 'text' as const, text: content }] : []),
        ...mentionParts,
      ],
    }
    const seed: AgentChatSession = {
      ...activeSession,
      messages: [...activeSession.messages, userMessage],
      updatedAt: Date.now(),
    }
    replaceSession(seed)
    setDraft('')
    setMentions([])
    await runLoop(seed)
  }, [activeSession, assets, hasGeminiApiKey, mentions, replaceSession, runLoop])

  const answerAskUser = useCallback((answers: Record<string, string | string[]>) => {
    if (!activeSession) return
    const seed: AgentChatSession = {
      ...activeSession,
      messages: [...activeSession.messages, answersToUserMessage(answers)],
      updatedAt: Date.now(),
    }
    replaceSession(seed)
    void runLoop(seed)
  }, [activeSession, replaceSession, runLoop])

  return {
    sessions,
    activeSession,
    activeSessionId,
    openSessionIds,
    draft,
    setDraft,
    mentions,
    setMentions,
    running,
    askUser,
    generationProgress,
    createSession,
    openSession,
    closeTab,
    deleteSession,
    sendText,
    stop,
    answerAskUser,
  }
}
