import { Clock, Plus, X } from 'lucide-react'
import type { AgentChatSession } from './agent-types'

export interface AgentTabBarProps {
  sessions: AgentChatSession[]
  openSessionIds: string[]
  activeSessionId: string | null
  historyOpen: boolean
  onToggleHistory: () => void
  onNewChat: () => void
  onOpenSession: (sessionId: string) => void
  onCloseTab: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
}

export function AgentTabBar(props: AgentTabBarProps) {
  const openSessions = props.openSessionIds
    .map(id => props.sessions.find(session => session.id === id))
    .filter((session): session is AgentChatSession => session != null)

  return (
    <div className="relative flex-shrink-0 border-b border-zinc-800">
      <div className="h-8 px-1.5 flex items-center gap-1 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto">
          {openSessions.map(session => {
            const active = session.id === props.activeSessionId
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => props.onOpenSession(session.id)}
                className={`group max-w-[140px] flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] truncate ${
                  active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span className="truncate">{session.title}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white"
                  onClick={event => {
                    event.stopPropagation()
                    props.onCloseTab(session.id)
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={props.onNewChat}
          className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800"
          aria-label="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={props.onToggleHistory}
          className={`p-1 rounded hover:bg-zinc-800 ${props.historyOpen ? 'text-white' : 'text-zinc-500 hover:text-white'}`}
          aria-label="Chat history"
        >
          <Clock className="h-3.5 w-3.5" />
        </button>
      </div>

      {props.historyOpen && (
        <div className="absolute right-1 top-8 z-30 w-56 max-h-64 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1">
          {props.sessions.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-zinc-500">No chats yet</p>
          ) : (
            props.sessions.map(session => (
              <div key={session.id} className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => {
                    props.onOpenSession(session.id)
                    props.onToggleHistory()
                  }}
                  className="flex-1 min-w-0 text-left px-1.5 py-1 rounded text-[11px] text-zinc-300 hover:bg-zinc-800 truncate"
                >
                  {session.title}
                </button>
                <button
                  type="button"
                  onClick={() => props.onDeleteSession(session.id)}
                  className="p-1 text-zinc-600 hover:text-red-400"
                  aria-label={`Delete ${session.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
