import type { ReactNode } from 'react'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(<span key={`t${key++}`}>{text.slice(last, match.index)}</span>)
    }
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(
        <code key={`c${key++}`} className="px-1 py-0.5 rounded bg-zinc-800 text-[11px] text-zinc-200">
          {token.slice(1, -1)}
        </code>,
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(<span key={`t${key++}`}>{text.slice(last)}</span>)
  return nodes
}

export function AgentMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null
  const lines = text.split('\n')
  return (
    <div className="text-[12px] text-zinc-200 leading-5 whitespace-pre-wrap break-words">
      {lines.map((line, index) => {
        const listMatch = line.match(/^[-*]\s+(.*)$/)
        if (listMatch) {
          return (
            <div key={index} className="flex gap-1.5">
              <span className="text-zinc-500">•</span>
              <span>{renderInline(listMatch[1])}</span>
            </div>
          )
        }
        return <div key={index}>{renderInline(escapeHtml(line) === line ? line : line)}</div>
      })}
    </div>
  )
}
