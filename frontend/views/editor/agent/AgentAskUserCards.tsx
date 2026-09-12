import { useState } from 'react'
import type { AgentAskUserQuestion } from './agent-types'

export function AgentAskUserCards(props: {
  questions: AgentAskUserQuestion[]
  disabled?: boolean
  onSubmit: (answers: Record<string, string | string[]>) => void
}) {
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [choiceAnswers, setChoiceAnswers] = useState<Record<string, string[]>>({})

  const submit = () => {
    const answers: Record<string, string | string[]> = {}
    for (const question of props.questions) {
      if (question.kind === 'text') {
        const value = textAnswers[question.id]?.trim()
        if (value) answers[question.id] = value
      } else {
        const value = choiceAnswers[question.id]
        if (value?.length) answers[question.id] = question.allowMultiple ? value : value[0]
      }
    }
    if (Object.keys(answers).length === 0) return
    props.onSubmit(answers)
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-t border-zinc-800 bg-zinc-950">
      {props.questions.map(question => (
        <div key={question.id} className="flex flex-col gap-1.5">
          <p className="text-[12px] text-zinc-300 whitespace-pre-wrap">{question.prompt}</p>
          {question.kind === 'text' ? (
            <input
              value={textAnswers[question.id] ?? ''}
              onChange={event => setTextAnswers(prev => ({ ...prev, [question.id]: event.target.value }))}
              disabled={props.disabled}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-100 outline-none focus:border-zinc-600"
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              {(question.options ?? []).map(option => {
                const selected = (choiceAnswers[question.id] ?? []).includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={props.disabled}
                    onClick={() => {
                      setChoiceAnswers(prev => {
                        const current = prev[question.id] ?? []
                        if (question.allowMultiple) {
                          return {
                            ...prev,
                            [question.id]: selected
                              ? current.filter(item => item !== option)
                              : [...current, option],
                          }
                        }
                        return { ...prev, [question.id]: [option] }
                      })
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] border ${
                      selected
                        ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={props.disabled}
        onClick={submit}
        className="self-start px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
      >
        Continue
      </button>
    </div>
  )
}
