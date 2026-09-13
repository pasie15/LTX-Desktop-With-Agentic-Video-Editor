import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../../lib/copy-text'

export function CopyCodeButton({
  value,
  label = 'code',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const code = value.trim()
  if (!code) return null

  return (
    <button
      type="button"
      onClick={async event => {
        event.stopPropagation()
        const ok = await copyText(code)
        if (!ok) return
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex items-center justify-center rounded-md p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export function CopyableCode({
  value,
  label = 'code',
}: {
  value: string
  label?: string
}) {
  const code = value.trim()
  if (!code) return null
  return (
    <span className="inline-flex items-center gap-1 font-mono text-white">
      {code}
      <CopyCodeButton value={code} label={label} />
    </span>
  )
}
