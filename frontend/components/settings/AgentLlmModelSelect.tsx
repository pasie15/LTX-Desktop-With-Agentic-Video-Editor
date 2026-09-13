import { useEffect, useState } from 'react'
import { CUSTOM_AGENT_LLM_MODEL_VALUE, type AgentLlmProviderKind } from '../../lib/agent-llm'
import { useAgentLlmModels } from '../../hooks/use-agent-llm-models'

export function AgentLlmModelSelect({
  kind,
  providerId,
  apiKey,
  baseUrl,
  value,
  onChange,
  disabled,
}: {
  kind: AgentLlmProviderKind
  providerId?: string
  apiKey?: string
  baseUrl?: string
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}) {
  const { models, source, error, loading } = useAgentLlmModels({
    kind,
    providerId,
    apiKey,
    baseUrl,
    model: value,
  })
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState(value)
  const options = models.some(model => model.id === value)
    ? models
    : value.trim()
      ? [...models, { id: value, displayName: value }]
      : models
  const selected = customOpen ? CUSTOM_AGENT_LLM_MODEL_VALUE : value

  useEffect(() => {
    if (!customOpen) setCustomValue(value)
  }, [customOpen, value])

  return (
    <div className="space-y-1.5">
      <select
        value={selected}
        disabled={disabled}
        onChange={event => {
          const next = event.target.value
          if (next === CUSTOM_AGENT_LLM_MODEL_VALUE) {
            setCustomOpen(true)
            return
          }
          setCustomOpen(false)
          onChange(next)
        }}
        onKeyDown={event => event.stopPropagation()}
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white disabled:opacity-50"
        aria-label="Agent model"
      >
        {options.length === 0 ? (
          <option value="">{loading ? 'Loading models…' : 'Select a model'}</option>
        ) : null}
        {options.map(model => (
          <option key={model.id} value={model.id} title={model.description}>
            {model.displayName}
          </option>
        ))}
        <option value={CUSTOM_AGENT_LLM_MODEL_VALUE}>Custom model…</option>
      </select>
      {customOpen ? (
        <input
          type="text"
          value={customValue}
          onChange={event => {
            setCustomValue(event.target.value)
            onChange(event.target.value)
          }}
          placeholder="Custom model id"
          onKeyDown={event => event.stopPropagation()}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500"
        />
      ) : null}
      <p className="text-[11px] text-zinc-500">
        {loading
          ? 'Loading models from the provider…'
          : source === 'provider'
            ? 'Latest models from this provider, then the rest of the list.'
            : error
              ? 'Using the listed models — the provider list was unavailable.'
              : 'Latest models first. Connect or add a key to refresh from the provider.'}
      </p>
    </div>
  )
}
