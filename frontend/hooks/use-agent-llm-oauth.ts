import { useCallback, useEffect, useState } from 'react'
import { ApiClient } from '../lib/api-client'
import { catalogEntry, type AgentLlmProviderKind } from '../lib/agent-llm'
import { logger } from '../lib/logger'

export type AgentLlmOAuthFlow = 'device' | 'code'

export interface AgentLlmOAuthSession {
  sessionId: string
  kind: AgentLlmProviderKind
  providerId: string
  flow: AgentLlmOAuthFlow
  authorizeUrl: string
  userCode: string
  message: string
}

interface UseAgentLlmOAuthResult {
  session: AgentLlmOAuthSession | null
  connecting: boolean
  error: string
  startConnect: (kind: AgentLlmProviderKind, providerId?: string) => Promise<void>
  completeCode: (code: string) => Promise<boolean>
  cancel: () => Promise<void>
  disconnect: (providerId: string) => Promise<boolean>
}

async function openAuthorizeUrl(url: string): Promise<void> {
  if (!url.startsWith('https://')) return
  const api = window.electronAPI
  if (api && 'openExternalUrl' in api) {
    await api.openExternalUrl({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function useAgentLlmOAuth(onConnected: () => Promise<void>): UseAgentLlmOAuthResult {
  const [session, setSession] = useState<AgentLlmOAuthSession | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const cancel = useCallback(async () => {
    const sessionId = session?.sessionId ?? ''
    setSession(null)
    setConnecting(false)
    if (!sessionId) return
    await ApiClient.agentLlmOAuthCancel({ sessionId })
  }, [session?.sessionId])

  const startConnect = useCallback(async (kind: AgentLlmProviderKind, providerId = '') => {
    if (!catalogEntry(kind).supportsConnect) return
    setError('')
    setConnecting(true)
    const result = await ApiClient.agentLlmOAuthStart({ kind, providerId })
    if (!result.ok) {
      setConnecting(false)
      setError(result.error.message || 'Could not start Connect.')
      logger.error(`Agent LLM OAuth start failed: ${result.error.message}`)
      return
    }
    const next: AgentLlmOAuthSession = {
      sessionId: result.data.sessionId,
      kind,
      providerId,
      flow: result.data.flow,
      authorizeUrl: result.data.authorizeUrl,
      userCode: result.data.userCode,
      message: result.data.message,
    }
    setSession(next)
    try {
      await openAuthorizeUrl(next.authorizeUrl)
    } catch (err) {
      logger.error(`Failed to open Connect URL: ${err}`)
    }
  }, [])

  const completeCode = useCallback(async (code: string) => {
    if (!session) return false
    const result = await ApiClient.agentLlmOAuthComplete({ sessionId: session.sessionId, code })
    if (!result.ok || result.data.status !== 'authenticated') {
      setError(result.ok ? (result.data.error || 'Connect failed.') : result.error.message)
      return false
    }
    setSession(null)
    setConnecting(false)
    await onConnected()
    return true
  }, [onConnected, session])

  const disconnect = useCallback(async (providerId: string) => {
    const result = await ApiClient.agentLlmOAuthDisconnect({ providerId })
    if (!result.ok) {
      setError(result.error.message || 'Could not disconnect.')
      return false
    }
    await onConnected()
    return true
  }, [onConnected])

  useEffect(() => {
    if (!session || session.flow !== 'device') return
    const interval = window.setInterval(async () => {
      const result = await ApiClient.agentLlmOAuthPoll({ sessionId: session.sessionId })
      if (!result.ok) {
        logger.error(`Agent LLM OAuth poll failed: ${result.error.message}`)
        return
      }
      if (result.data.status === 'pending') return
      if (result.data.status === 'authenticated') {
        setSession(null)
        setConnecting(false)
        await onConnected()
        return
      }
      setError(result.data.error || 'Sign-in was not completed.')
      setSession(null)
      setConnecting(false)
    }, 2500)
    return () => window.clearInterval(interval)
  }, [onConnected, session])

  return { session, connecting, error, startConnect, completeCode, cancel, disconnect }
}
