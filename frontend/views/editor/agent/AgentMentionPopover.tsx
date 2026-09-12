import type { Asset } from '../../../types/project-model'
import type { AgentMention } from './agent-types'

export interface AgentMentionOption {
  id: string
  label: string
  detail?: string
  mention: AgentMention
}

export function buildMentionOptions(input: {
  assets: Asset[]
  query: string
  selectedClipIds: string[]
  inPoint: number | null
  outPoint: number | null
  mentionFromAsset: (asset: Asset) => AgentMention
  mentionFromSelection: (clipIds: string[]) => AgentMention
  mentionFromRange: (inPoint: number, outPoint: number) => AgentMention
  filterAssets: (assets: Asset[], query: string) => Asset[]
}): AgentMentionOption[] {
  const options: AgentMentionOption[] = []
  const lowered = input.query.toLowerCase()
  if (input.selectedClipIds.length > 0 && 'selection'.includes(lowered)) {
    options.push({
      id: 'selection',
      label: input.selectedClipIds.length === 1 ? 'Add selection' : `Add selection (${input.selectedClipIds.length})`,
      mention: input.mentionFromSelection(input.selectedClipIds),
    })
  }
  if (
    input.inPoint != null
    && input.outPoint != null
    && input.outPoint > input.inPoint
    && ('range'.includes(lowered) || 'in'.includes(lowered) || 'out'.includes(lowered))
  ) {
    options.push({
      id: 'range',
      label: 'Add In/Out range',
      mention: input.mentionFromRange(input.inPoint, input.outPoint),
    })
  }
  for (const asset of input.filterAssets(input.assets, input.query)) {
    options.push({
      id: asset.id,
      label: asset.prompt || asset.id,
      detail: asset.type,
      mention: input.mentionFromAsset(asset),
    })
  }
  return options.slice(0, 14)
}

export function AgentMentionPopover(props: {
  options: AgentMentionOption[]
  activeIndex: number
  onSelect: (option: AgentMentionOption) => void
}) {
  if (props.options.length === 0) return null
  return (
    <div className="absolute left-2 right-2 bottom-full mb-1 max-h-48 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1 z-20">
      {props.options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          onMouseDown={event => {
            event.preventDefault()
            props.onSelect(option)
          }}
          className={`w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 ${
            index === props.activeIndex ? 'bg-zinc-800 text-white' : 'text-zinc-300'
          }`}
        >
          <span className="truncate">{option.label}</span>
          {option.detail && <span className="ml-auto text-[10px] text-zinc-500">{option.detail}</span>}
        </button>
      ))}
    </div>
  )
}
