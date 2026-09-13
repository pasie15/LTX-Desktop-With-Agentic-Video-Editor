import { useEffect, useMemo, useState } from 'react'
import { ApiClient } from '../lib/api-client'
import {
  mergeAgentLlmModelOptions,
  type AgentLlmModelOption,
  type AgentLlmProviderKind,
} from '../lib/agent-llm'

export interface AgentLlmModelsQuery {
  kind: AgentLlmProviderKind
  providerId?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  // Flip after Save Key / Connect so a saved provider refetches without a typed key.
  credentialsRevision?: string
}

export function useAgentLlmModels(query: AgentLlmModelsQuery) {
  const catalog = useMemo(
    () => mergeAgentLlmModelOptions([], query.kind, query.model ?? ''),
    [query.kind, query.model],
  )
  const [models, setModels] = useState<AgentLlmModelOption[]>(catalog)
  const [source, setSource] = useState<'catalog' | 'provider'>('catalog')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const providerId = query.providerId?.trim() ?? ''
  const apiKey = query.apiKey?.trim() ?? ''
  const baseUrl = query.baseUrl?.trim() ?? ''
  const model = query.model?.trim() ?? ''
  const credentialsRevision = query.credentialsRevision?.trim() ?? ''

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const result = await ApiClient.listAgentLlmModels({
        kind: query.kind,
        providerId,
        apiKey,
        baseUrl,
        model,
      })
      if (cancelled) return
      if (!result.ok) {
        setModels(mergeAgentLlmModelOptions([], query.kind, model))
        setSource('catalog')
        setError(result.error.message)
        setLoading(false)
        return
      }
      const incoming = result.data.source === 'provider' ? result.data.models : []
      setModels(mergeAgentLlmModelOptions(incoming, query.kind, result.data.resolvedModel || model))
      setSource(result.data.source)
      setError(result.data.error)
      setLoading(false)
    }, apiKey && !providerId ? 350 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query.kind, providerId, apiKey, baseUrl, model, credentialsRevision])

  return { models, source, error, loading }
}
