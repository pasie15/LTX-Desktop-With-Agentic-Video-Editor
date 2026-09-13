import { useCallback, useEffect, useState } from 'react'
import type { Asset } from '../../../types/project-model.ts'
import { mentionFromAsset } from './agent-mentions.ts'
import {
  AGENT_REFS_CHANGED_EVENT,
  getProjectRefStore,
  type AgentRef,
  type AgentRefRole,
} from './agent-refs.ts'
import type { AgentMention } from './agent-types.ts'

export interface AgentRefsStripProps {
  projectId: string
  assets: Asset[]
  selectedAssetId?: string | null
  onAttachMention: (mention: AgentMention) => void
}

function roleLabel(role: AgentRefRole): string {
  return role[0]!.toUpperCase() + role.slice(1)
}

export function AgentRefsStrip(props: AgentRefsStripProps) {
  const store = getProjectRefStore(props.projectId)
  const [refs, setRefs] = useState<AgentRef[]>(() => store.list())

  const reload = useCallback(() => {
    setRefs(getProjectRefStore(props.projectId).list())
  }, [props.projectId])

  useEffect(() => {
    reload()
    const handler = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      if (event.detail?.projectId && event.detail.projectId !== props.projectId) return
      reload()
    }
    window.addEventListener(AGENT_REFS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(AGENT_REFS_CHANGED_EVENT, handler)
  }, [props.projectId, reload])

  const selectedImage = props.selectedAssetId
    ? props.assets.find(asset => asset.id === props.selectedAssetId && asset.type === 'image')
    : undefined

  const attach = (ref: AgentRef) => {
    const asset = props.assets.find(item => item.id === ref.assetId)
    if (!asset) return
    props.onAttachMention(mentionFromAsset(asset))
  }

  const addSelected = () => {
    if (!selectedImage) return
    store.register({
      name: selectedImage.prompt || selectedImage.id,
      assetId: selectedImage.id,
      role: 'character',
    })
    reload()
  }

  return (
    <div className="px-3 py-2 border-b border-zinc-800 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Refs</span>
        <button
          type="button"
          onClick={addSelected}
          disabled={!selectedImage}
          className="text-[10px] text-blue-400 hover:text-blue-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
        >
          Add selected still
        </button>
      </div>
      {refs.length === 0 ? (
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Character and object stills stay consistent across shots. Add a still, then attach it on assemble.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {refs.map(ref => (
            <button
              key={ref.id}
              type="button"
              onClick={() => attach(ref)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 hover:border-zinc-600 hover:text-white"
              title={`${roleLabel(ref.role)} · ${ref.assetId}`}
            >
              <span className="text-zinc-500">{roleLabel(ref.role)}</span>
              {ref.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
