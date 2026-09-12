import { GEMINI_KEY_REQUIRED_SETTINGS_DETAIL } from '../../../lib/enhance-gemini-key'
import { AgentMarkdown } from './agent-markdown'
import { toolRowLabel } from './tool-definitions'
import type { AgentChatMessage } from './agent-types'

function openGeminiSettings(): void {
  window.dispatchEvent(new CustomEvent('open-settings', {
    detail: GEMINI_KEY_REQUIRED_SETTINGS_DETAIL,
  }))
}

function isKeyError(code?: string): boolean {
  return code === 'GEMINI_API_KEY_MISSING' || code === 'GEMINI_INVALID_API_KEY'
}

export function AgentMessageList(props: {
  messages: AgentChatMessage[]
  running: boolean
}) {
  const visible = props.messages.filter(message => message.role !== 'tool')
  return (
    <div className="flex flex-col gap-3">
      {visible.map(message => (
        <article key={message.id} className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-zinc-600">
            {message.role === 'user' ? 'You' : 'Agent'}
          </span>
          {message.parts.map((part, index) => {
            if (part.type === 'text' && part.text) {
              return (
                <div key={`${message.id}-t${index}`}>
                  <AgentMarkdown text={part.text} />
                </div>
              )
            }
            if (part.type === 'tool_call') {
              return (
                <div
                  key={`${message.id}-c${index}`}
                  className="text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded px-2 py-1"
                >
                  {toolRowLabel(part.name)}
                </div>
              )
            }
            if (part.type === 'inline_image') {
              return (
                <img
                  key={`${message.id}-i${index}`}
                  alt={part.name || 'Mentioned still'}
                  src={`data:${part.mimeType};base64,${part.data}`}
                  className="max-h-24 rounded border border-zinc-800"
                />
              )
            }
            return null
          })}
          {isKeyError(message.errorCode) && (
            <button
              type="button"
              onClick={openGeminiSettings}
              className="self-start text-[11px] text-blue-400 hover:text-blue-300"
            >
              Fix Gemini API key in Settings
            </button>
          )}
        </article>
      ))}
      {props.running && (
        <div className="flex items-center gap-1 text-zinc-500 text-[11px]" aria-label="Thinking">
          <span className="w-1 h-1 rounded-full bg-zinc-500 animate-pulse" />
          <span className="w-1 h-1 rounded-full bg-zinc-500 animate-pulse [animation-delay:120ms]" />
          <span className="w-1 h-1 rounded-full bg-zinc-500 animate-pulse [animation-delay:240ms]" />
        </div>
      )}
    </div>
  )
}
