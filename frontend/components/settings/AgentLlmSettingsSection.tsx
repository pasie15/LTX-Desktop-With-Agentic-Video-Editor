import { AlertCircle, Check, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type RefObject } from 'react'
import { ApiClient } from '../../lib/api-client'
import {
  AGENT_LLM_CATALOG,
  BUILTIN_GEMINI_PROVIDER_ID,
  catalogEntry,
  createAgentLlmProviderId,
  providerDisplayLabel,
  type AgentLlmProviderKind,
  type AgentLlmProviderPublic,
} from '../../lib/agent-llm'
import type { AppSettings } from '../../contexts/AppSettingsContext'

interface AgentLlmSettingsSectionProps {
  settings: AppSettings
  sectionRef: RefObject<HTMLDivElement>
  showBanner: boolean
  onSaved: () => Promise<void>
}

interface DraftProvider {
  kind: AgentLlmProviderKind
  label: string
  apiKey: string
  model: string
  baseUrl: string
}

const emptyDraft = (): DraftProvider => ({
  kind: 'openai',
  label: '',
  apiKey: '',
  model: '',
  baseUrl: '',
})

function toPublicPatch(providers: AgentLlmProviderPublic[]) {
  return providers.map(provider => ({
    id: provider.id,
    kind: provider.kind,
    label: provider.label,
    apiKey: '',
    model: provider.model,
    baseUrl: provider.baseUrl,
  }))
}

export function AgentLlmSettingsSection({
  settings,
  sectionRef,
  showBanner,
  onSaved,
}: AgentLlmSettingsSectionProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<DraftProvider>(emptyDraft)
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const catalog = useMemo(() => catalogEntry(draft.kind), [draft.kind])

  const selectedId = settings.agentLlmProviderId.trim() || BUILTIN_GEMINI_PROVIDER_ID
  const selectedProvider = settings.agentLlmProviders.find(provider => provider.id === selectedId)
  const selectedLabel = selectedProvider
    ? providerDisplayLabel(selectedProvider)
    : 'Gemini (Settings)'

  const persist = async (patch: Parameters<typeof ApiClient.updateSettings>[0]) => {
    setBusy(true)
    try {
      const result = await ApiClient.updateSettings(patch)
      if (!result.ok) return
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const handleSelect = (providerId: string) => {
    void persist({ agentLlmProviderId: providerId === BUILTIN_GEMINI_PROVIDER_ID ? '' : providerId })
  }

  const handleAdd = async () => {
    const entry = catalogEntry(draft.kind)
    if (entry.requiresBaseUrl && !draft.baseUrl.trim()) return
    if (entry.requiresBaseUrl && !draft.model.trim()) return
    if (draft.kind !== 'gemini' && !entry.requiresBaseUrl && !draft.apiKey.trim()) return
    if (draft.kind === 'gemini' && !draft.apiKey.trim() && !settings.hasGeminiApiKey) return

    const next = {
      id: createAgentLlmProviderId(),
      kind: draft.kind,
      label: draft.label.trim() || entry.label,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim(),
    }
    await persist({
      agentLlmProviderId: next.id,
      agentLlmProviders: [...toPublicPatch(settings.agentLlmProviders), next],
    })
    setDraft(emptyDraft())
    setAdding(false)
  }

  const handleRemove = (providerId: string) => {
    const remaining = settings.agentLlmProviders.filter(provider => provider.id !== providerId)
    const nextSelected = selectedId === providerId ? '' : settings.agentLlmProviderId
    void persist({
      agentLlmProviderId: nextSelected,
      agentLlmProviders: toPublicPatch(remaining),
    })
  }

  const handleReplaceKey = (provider: AgentLlmProviderPublic) => {
    const nextKey = (keyInputs[provider.id] ?? '').trim()
    if (!nextKey) return
    void persist({
      agentLlmProviders: settings.agentLlmProviders.map(item => (
        item.id === provider.id
          ? { ...toPublicPatch([item])[0], apiKey: nextKey }
          : toPublicPatch([item])[0]
      )),
    })
    setKeyInputs(current => ({ ...current, [provider.id]: '' }))
  }

  const handleModelChange = (provider: AgentLlmProviderPublic, model: string) => {
    void persist({
      agentLlmProviders: settings.agentLlmProviders.map(item => (
        item.id === provider.id
          ? { ...toPublicPatch([item])[0], model }
          : toPublicPatch([item])[0]
      )),
    })
  }

  return (
    <div ref={sectionRef} className="space-y-4 pt-4 border-t border-zinc-800 scroll-mt-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Agent LLM</h3>
      </div>

      {showBanner && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>Add an API key for the selected Agent provider to use chat.</span>
        </div>
      )}

      <p className="text-xs text-zinc-500 leading-relaxed">
        The Video Editor Agent uses this provider for chat and tool calls. Gemini for Enhance and
        gap suggestions stays above. Keys stay in Settings — they are never written into a project.
      </p>

      <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-zinc-400">Active provider</span>
          <select
            value={selectedId}
            onChange={event => handleSelect(event.target.value)}
            disabled={busy}
            onKeyDown={event => event.stopPropagation()}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white disabled:opacity-50"
          >
            <option value={BUILTIN_GEMINI_PROVIDER_ID}>
              Gemini (Settings){settings.hasGeminiApiKey ? '' : ' — add key above'}
            </option>
            {settings.agentLlmProviders.map(provider => (
              <option key={provider.id} value={provider.id}>
                {providerDisplayLabel(provider)}
                {provider.hasApiKey || provider.kind === 'gemini' ? '' : ' — key required'}
              </option>
            ))}
          </select>
        </label>

        <div className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1.5 ${
          settings.hasAgentLlmKey
            ? 'bg-green-500/10 text-green-400'
            : 'bg-amber-500/10 text-amber-400'
        }`}>
          {settings.hasAgentLlmKey ? (
            <>
              <Check className="h-3 w-3" />
              Agent will use {selectedLabel}
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              API key required for Agent
            </>
          )}
        </div>

        {settings.agentLlmProviders.length > 0 && (
          <ul className="space-y-3">
            {settings.agentLlmProviders.map(provider => {
              const entry = catalogEntry(provider.kind)
              return (
                <li key={provider.id} className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm text-white">{providerDisplayLabel(provider)}</p>
                      <p className="text-[11px] text-zinc-500">{entry.label}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(provider.id)}
                      disabled={busy}
                      className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-50"
                      aria-label={`Remove ${providerDisplayLabel(provider)}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={provider.model}
                    onChange={event => handleModelChange(provider, event.target.value)}
                    placeholder={entry.defaultModel || 'Model id'}
                    onKeyDown={event => event.stopPropagation()}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
                  />
                  {provider.baseUrl ? (
                    <p className="text-[11px] text-zinc-500 break-all">{provider.baseUrl}</p>
                  ) : null}
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={keyInputs[provider.id] ?? ''}
                      onChange={event => setKeyInputs(current => ({ ...current, [provider.id]: event.target.value }))}
                      placeholder={provider.hasApiKey ? 'Enter new key to replace...' : 'Enter API key...'}
                      onKeyDown={event => event.stopPropagation()}
                      className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleReplaceKey(provider)}
                      disabled={busy || !(keyInputs[provider.id] ?? '').trim()}
                      className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                    >
                      Save Key
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {adding ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-2">
            <select
              value={draft.kind}
              onChange={event => {
                const kind = event.target.value as AgentLlmProviderKind
                const entry = catalogEntry(kind)
                setDraft({
                  kind,
                  label: '',
                  apiKey: '',
                  model: entry.defaultModel,
                  baseUrl: entry.defaultBaseUrl,
                })
              }}
              onKeyDown={event => event.stopPropagation()}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
            >
              {AGENT_LLM_CATALOG.map(entry => (
                <option key={entry.kind} value={entry.kind}>{entry.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={draft.label}
              onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
              placeholder="Label (optional)"
              onKeyDown={event => event.stopPropagation()}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
            />
            <input
              type="password"
              value={draft.apiKey}
              onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))}
              placeholder={draft.kind === 'gemini' ? 'API key (or reuse Gemini above)' : 'API key'}
              onKeyDown={event => event.stopPropagation()}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
            />
            <input
              type="text"
              value={draft.model}
              onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
              placeholder={catalog.defaultModel || 'Model id'}
              onKeyDown={event => event.stopPropagation()}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
            />
            {(catalog.requiresBaseUrl || draft.kind.startsWith('custom_')) && (
              <input
                type="url"
                value={draft.baseUrl}
                onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://api.example.com/v1"
                onKeyDown={event => event.stopPropagation()}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
              />
            )}
            {catalog.keyUrl ? (
              <a
                href={catalog.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
                onClick={event => event.stopPropagation()}
              >
                Get {catalog.label} API key →
              </a>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={busy}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                Add provider
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setDraft(emptyDraft())
                }}
                className="px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              const entry = catalogEntry('openai')
              setDraft({
                kind: 'openai',
                label: '',
                apiKey: '',
                model: entry.defaultModel,
                baseUrl: entry.defaultBaseUrl,
              })
              setAdding(true)
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add provider
          </button>
        )}
      </div>
    </div>
  )
}
