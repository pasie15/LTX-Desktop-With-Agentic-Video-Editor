import { useCallback, useEffect, useRef, useState } from 'react'
import type { Asset } from '../../../types/project-model'
import type { EditorState, TimelineGapSelection } from '../editor-state'
import { useEditorApply } from '../editor-store'
import { addVisualAssetToProject } from '../../../lib/asset-copy'
import { defaultImportLocalMediaCopyFns } from '../import-local-media-defaults'
import { importLocalMediaPath } from '../import-local-media'
import { detectApproveAllIntent } from './agent-approvals'
import { AGENT_INSTRUCTIONS } from './agent-instructions'
import { requestAgentTurn } from './agent-api'
import { createAgentGenerationJobs } from './agent-generation-jobs'
import { answersToUserMessage, runAgentLoop } from './agent-loop'
import {
  countUserTurns,
  lastUserText,
  parseHydratedMemory,
  restorePendingAskUser,
  serializeHydratedMemory,
} from './agent-session-memory'
import { mentionPartsForMessage, mentionsFromMessages, preferredAssemblyMediaFromMentions } from './agent-mentions'
import { getAgentChatStorage, loadAgentSessions } from './agent-persistence'
import { buildAgentSnapshot } from './agent-snapshot'
import { AGENT_TOOL_DEFINITIONS } from './tool-definitions'
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
  hasAgentLlmKey: boolean
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
    hasAgentLlmKey,
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
  const approveAllRef = useRef(false)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const executorHostRef = useRef({
    getState: getEditorState,
    applyWithHistory,
    applyWithoutHistory,
    getSelectedGap,
    getAbortSignal: () => abortRef.current?.signal ?? null,
    onProgress: (progress: AgentGenerationProgress) => setGenerationProgress(progress),
    getApproveAll: () => approveAllRef.current,
    getPreferredAssemblyMedia: () => {
      const session = sessionsRef.current.find(item => item.id === activeSessionIdRef.current) ?? null
      return preferredAssemblyMediaFromMentions(
        mentionsFromMessages(session?.messages ?? []),
        executorHostRef.current.getState().editorModel.assets,
      )
    },
    readAssetPreview: async (asset: Asset) => {
      const filePath = asset.smallThumbnailPath || asset.bigThumbnailPath || asset.path
      if (!filePath || !window.electronAPI?.readLocalFile) return null
      try {
        const file = await window.electronAPI.readLocalFile({ filePath })
        return { mimeType: file.mimeType, data: file.data, name: asset.prompt || asset.id }
      } catch {
        return null
      }
    },
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
      importMedia: {
        importPath: ({ srcPath, type, displayName }) => importLocalMediaPath({
          srcPath,
          projectId: projectIdRef.current,
          type,
          displayName,
          copy: defaultImportLocalMediaCopyFns,
        }),
      },
      getSelectedGap: () => executorHostRef.current.getSelectedGap?.() ?? null,
      projectId,
      getAbortSignal: () => executorHostRef.current.getAbortSignal(),
      onProgress: progress => executorHostRef.current.onProgress(progress),
      getApproveAll: () => executorHostRef.current.getApproveAll(),
      readAssetPreview: asset => executorHostRef.current.readAssetPreview(asset),
      getPreferredAssemblyMedia: () => executorHostRef.current.getPreferredAssemblyMedia?.() ?? {},
    })
  }
  executorRef.current.host.generation = generationJobsRef.current
  executorRef.current.host.importMedia = {
    importPath: ({ srcPath, type, displayName }) => importLocalMediaPath({
      srcPath,
      projectId: projectIdRef.current,
      type,
      displayName,
      copy: defaultImportLocalMediaCopyFns,
    }),
  }
  executorRef.current.host.getSelectedGap = () => executorHostRef.current.getSelectedGap?.() ?? null
  executorRef.current.host.projectId = projectId
  executorRef.current.host.getAbortSignal = () => executorHostRef.current.getAbortSignal()
  executorRef.current.host.onProgress = progress => executorHostRef.current.onProgress(progress)
  executorRef.current.host.getApproveAll = () => executorHostRef.current.getApproveAll()
  executorRef.current.host.readAssetPreview = asset => executorHostRef.current.readAssetPreview(asset)
  executorRef.current.host.getPreferredAssemblyMedia = () => (
    executorHostRef.current.getPreferredAssemblyMedia?.() ?? {}
  )

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null
  approveAllRef.current = activeSession?.approveAll === true

  const attachExecutorMemory = useCallback((session: AgentChatSession, pendingAskUser?: AgentAskUserQuestion[] | null): AgentChatSession => {
    const exported = executorRef.current?.exportMemory()
    const hydrated = exported
      ? {
          plan: exported.plan,
          assemblyProposal: exported.assemblyProposal,
          assemblyProgress: exported.assemblyProgress,
          assemblyConfirmedMore: exported.assemblyConfirmedMore,
          pendingAskUser: pendingAskUser === undefined
            ? parseHydratedMemory(session.memory).pendingAskUser
            : pendingAskUser,
        }
      : parseHydratedMemory(session.memory)
    if (pendingAskUser !== undefined) hydrated.pendingAskUser = pendingAskUser
    return {
      ...session,
      memory: serializeHydratedMemory(hydrated),
    }
  }, [])

  const hydrateExecutor = useCallback((session: AgentChatSession) => {
    const memory = parseHydratedMemory(session.memory)
    executorRef.current?.hydrateMemory(memory)
  }, [])

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
        hydrateExecutor(fresh)
        setAskUser(null)
        return
      }
      setSessions(loaded)
      setActiveSessionId(loaded[0].id)
      setOpenSessionIds([loaded[0].id])
      hydrateExecutor(loaded[0])
      setAskUser(restorePendingAskUser(loaded[0]))
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
      hydrateExecutor(fresh)
      setAskUser(null)
    })
    return () => {
      cancelled = true
    }
  }, [hydrateExecutor, projectId])

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
    executorRef.current?.hydrateMemory({
      plan: null,
      assemblyProposal: null,
      assemblyProgress: null,
      assemblyConfirmedMore: false,
    })
    persistSession(fresh)
  }, [persistSession])

  const openSession = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find(item => item.id === sessionId)
    setActiveSessionId(sessionId)
    setOpenSessionIds(prev => prev.includes(sessionId) ? prev : [...prev, sessionId])
    if (session) {
      hydrateExecutor(session)
      setAskUser(restorePendingAskUser(session))
      return
    }
    setAskUser(null)
  }, [hydrateExecutor])

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
      hydrateExecutor(seed)
      const result = await runAgentLoop({
        getMessages: () => latest,
        getProjectContext: () => {
          const exported = executorRef.current?.exportMemory()
          return buildAgentSnapshot({
            state: getEditorState(),
            projectId,
            projectName,
            generationBusy,
            generationCanCancel,
            currentModelLabel,
            selectedGapOverride: getSelectedGap?.() ?? null,
            refs: executorRef.current?.host.refs?.list() ?? [],
            approveAll: seed.approveAll === true,
            plan: exported?.plan ?? executorRef.current?.getLastPlan() ?? null,
            conversation: {
              continued: countUserTurns(latest) > 1,
              userTurns: countUserTurns(latest),
              ...(lastUserText(latest) ? { lastUserText: lastUserText(latest).slice(0, 240) } : {}),
              ...(exported?.assemblyProgress?.stage
                ? {
                    assemblyStage: exported.assemblyProgress.stage,
                    assemblyShotIndex: exported.assemblyProgress.shotIndex,
                  }
                : {}),
            },
          }) as unknown as Record<string, unknown>
        },
        availableTools: AGENT_TOOL_DEFINITIONS,
        skills: AGENT_INSTRUCTIONS,
        requestTurn: requestAgentTurn,
        executeTool: (name, args) => executeAgentTool(executorRef.current!, name, args),
        onMessages: (messages) => {
          latest = messages
          replaceSession(attachExecutorMemory({ ...seed, messages }))
        },
        onAskUser: questions => {
          setAskUser(questions)
          replaceSession(attachExecutorMemory({ ...seed, messages: latest }, questions))
        },
        signal: controller.signal,
      })
      replaceSession(attachExecutorMemory(
        { ...seed, messages: result.messages },
        result.stopReason === 'ask_user' ? undefined : null,
      ))
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
    attachExecutorMemory,
    hydrateExecutor,
  ])

  const sendText = useCallback(async (text: string, extraMentions: AgentMention[] = []) => {
    const content = text.trim()
    const attached = [...mentions, ...extraMentions]
    if (!content && attached.length === 0) return
    if (!hasAgentLlmKey || !activeSession) return

    const autonomy = detectApproveAllIntent(content)
    const sessionWithAutonomy: AgentChatSession = autonomy == null
      ? activeSession
      : { ...activeSession, approveAll: autonomy }
    if (autonomy != null) approveAllRef.current = autonomy

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
      ...sessionWithAutonomy,
      messages: [...sessionWithAutonomy.messages, userMessage],
      updatedAt: Date.now(),
    }
    replaceSession(seed)
    setDraft('')
    setMentions([])
    await runLoop(seed)
  }, [activeSession, assets, hasAgentLlmKey, mentions, replaceSession, runLoop])

  const answerAskUser = useCallback((answers: Record<string, string | string[]>) => {
    if (!activeSession) return
    executorRef.current?.rememberAssemblyAcceptance(answers)
    const seed: AgentChatSession = {
      ...activeSession,
      messages: [...activeSession.messages, answersToUserMessage(answers)],
      updatedAt: Date.now(),
    }
    replaceSession(seed)
    void runLoop(seed)
  }, [activeSession, replaceSession, runLoop])

  const setApproveAll = useCallback((value: boolean) => {
    approveAllRef.current = value
    if (!activeSession) return
    const next = { ...activeSession, approveAll: value, updatedAt: Date.now() }
    replaceSession(next)
    if (value && askUser) {
      executorRef.current?.rememberAssemblyAcceptance({ review: 'Approve' })
      const seed: AgentChatSession = {
        ...next,
        messages: [...next.messages, {
          id: createAgentMessageId(),
          role: 'user',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: 'Approve all — continue without asking each step.' }],
        }],
      }
      replaceSession(seed)
      setAskUser(null)
      void runLoop(seed)
    }
  }, [activeSession, askUser, replaceSession, runLoop])

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
    approveAll: activeSession?.approveAll === true,
    setApproveAll,
  }
}
