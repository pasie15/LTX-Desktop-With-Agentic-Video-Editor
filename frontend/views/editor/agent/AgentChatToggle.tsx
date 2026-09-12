import { MessageSquare } from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { tooltipLabel } from '../video-editor-utils'
import { agentChatToggleCopy } from './agent-chat-toggle'

export type AgentChatToggleVariant = 'menubar' | 'toolbar' | 'rail'

export interface AgentChatToggleProps {
  open: boolean
  shortcut?: string
  onToggle: () => void
  variant: AgentChatToggleVariant
}

export function AgentChatToggle(props: AgentChatToggleProps) {
  const copy = agentChatToggleCopy(props.open)
  const tooltip = tooltipLabel(copy.actionLabel, props.shortcut ?? '')
  const tooltipSide = props.variant === 'menubar' ? 'bottom' : props.variant === 'rail' ? 'left' : 'right'

  if (props.variant === 'rail') {
    return (
      <Tooltip content={tooltip} side={tooltipSide} className="h-full w-10 flex-shrink-0">
        <button
          type="button"
          data-testid="agent-chat-toggle-rail"
          aria-pressed={copy.pressed}
          aria-label={copy.actionLabel}
          onClick={props.onToggle}
          className="w-10 h-full border-l border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-200 hover:text-white transition-colors flex flex-col items-center justify-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180">
            {copy.visibleLabel}
          </span>
        </button>
      </Tooltip>
    )
  }

  if (props.variant === 'toolbar') {
    return (
      <Tooltip content={tooltip} side={tooltipSide}>
        <button
          type="button"
          data-testid="agent-chat-toggle-toolbar"
          aria-pressed={copy.pressed}
          aria-label={copy.actionLabel}
          onClick={props.onToggle}
          className={`w-full flex flex-col items-center gap-0.5 px-0.5 py-1.5 rounded-lg transition-colors flex-shrink-0 ${
            copy.pressed ? 'bg-blue-600 text-white' : 'text-zinc-200 hover:bg-zinc-800 hover:text-white'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-[9px] font-semibold leading-none">{copy.visibleLabel}</span>
        </button>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={tooltip} side={tooltipSide}>
      <button
        type="button"
        data-testid="agent-chat-toggle-menubar"
        aria-pressed={copy.pressed}
        aria-label={copy.actionLabel}
        onClick={props.onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition-colors ${
          copy.pressed ? 'bg-blue-600 text-white' : 'text-zinc-200 hover:text-white hover:bg-zinc-800/50'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {copy.visibleLabel}
      </button>
    </Tooltip>
  )
}
