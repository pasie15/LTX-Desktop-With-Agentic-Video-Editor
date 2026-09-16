import type { AgentAskUserQuestion } from './agent-types.ts'

export type AgentReviewCheckpoint =
  | 'still'
  | 'last_frame'
  | 'illustration'
  | 'character_sheet'
  | 'scene_sheet'
  | 'video'
  | 'place'
  | 'next_shot'

export interface AgentReviewPreview {
  mimeType: string
  data: string
  name?: string
}

export function detectApproveAllIntent(text: string): boolean | null {
  const lowered = text.toLowerCase()
  if (
    /\b(approve all|approve everything|full autonomy|just do it|don'?t ask|do not ask|no need to ask|don'?t wait|go autonomous|autonomous mode)\b/.test(lowered)
  ) {
    return true
  }
  if (
    /\b(ask (me )?(each|every|per) (step|shot)|wait for (my )?approval|turn off approve all|stop approve all|don'?t approve all)\b/.test(lowered)
  ) {
    return false
  }
  return null
}

function firstAnswer(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export function isApprovalYes(value: unknown): boolean {
  const text = firstAnswer(value).trim().toLowerCase()
  return text === 'approve' || text === 'yes' || text === 'accept' || text.startsWith('proceed with')
}

export function isApprovalNo(value: unknown): boolean {
  const text = firstAnswer(value).trim().toLowerCase()
  return text === 'reject' || text === 'no' || text === 'cancel' || text === 'stop'
}

export function isApprovalRevise(value: unknown): boolean {
  return firstAnswer(value).trim().toLowerCase() === 'revise'
}

export function reviewDecisionFromAnswers(
  answers: Record<string, string | string[]>,
): 'approve' | 'reject' | 'revise' | null {
  const value = answers.review ?? answers.confirm ?? answers.shot_list
  if (isApprovalRevise(value) || (typeof answers.revise === 'string' && answers.revise.trim())) return 'revise'
  if (isApprovalNo(value)) return 'reject'
  if (isApprovalYes(value)) return 'approve'
  return null
}

export function checkpointLabel(checkpoint: string): string {
  switch (checkpoint) {
    case 'last_frame':
      return 'Last-frame still'
    case 'illustration':
      return 'Illustration'
    case 'character_sheet':
      return 'Character sheet'
    case 'scene_sheet':
      return 'Scene sheet'
    case 'video':
      return 'Video'
    case 'place':
      return 'Timeline place'
    case 'next_shot':
      return 'Next shot'
    default:
      return 'First-frame still'
  }
}

export function checkpointFromGenerate(
  args: Record<string, unknown>,
  media: 'image' | 'video',
): AgentReviewCheckpoint {
  if (media === 'video') return 'video'
  const prompt = typeof args.prompt === 'string' ? args.prompt : ''
  const role = typeof args.role === 'string'
    ? args.role
    : typeof args.sheet === 'string'
      ? args.sheet
      : ''
  const blob = `${role} ${prompt}`.toLowerCase()
  if (/\blast[- ]?frame\b/.test(blob)) return 'last_frame'
  if (
    /\bcharacter sheet\b/.test(blob)
    || /\blookbook\b/.test(blob)
    || /\bt-pose\b/.test(blob)
    || /\breference sheet\b/.test(blob)
    || role === 'character'
  ) {
    return 'character_sheet'
  }
  if (/\bscene sheet\b/.test(blob) || role === 'scene' || role === 'location') return 'scene_sheet'
  if (/\billustration\b/.test(blob)) return 'illustration'
  return 'still'
}

export function parseReviewPreview(raw: unknown): AgentReviewPreview | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const item = raw as Record<string, unknown>
  if (typeof item.mimeType !== 'string' || typeof item.data !== 'string' || !item.data) return undefined
  return {
    mimeType: item.mimeType,
    data: item.data,
    ...(typeof item.name === 'string' ? { name: item.name } : {}),
  }
}

export function reviewQuestionsFromResult(result: Record<string, unknown>): AgentAskUserQuestion[] | null {
  if (result.needsReview !== true) return null
  const checkpoint = typeof result.checkpoint === 'string' ? result.checkpoint : 'still'
  const shot = typeof result.shotTitle === 'string' && result.shotTitle
    ? result.shotTitle
    : typeof result.shotId === 'string' ? result.shotId : ''
  const next = typeof result.nextStep === 'string' && result.nextStep
    ? result.nextStep
    : 'the next step'
  const label = checkpointLabel(checkpoint)
  const prompt = shot
    ? `${label} for ${shot}. Approve to continue with ${next}, or reject / revise in the composer.`
    : `${label} is ready. Approve to continue with ${next}, or reject / revise in the composer.`
  const preview = parseReviewPreview(result.preview)
  return [{
    id: 'review',
    prompt,
    kind: 'approval',
    options: ['Approve', 'Revise', 'Reject'],
    ...(typeof result.assetId === 'string' ? { assetId: result.assetId } : {}),
    ...(preview ? { preview } : {}),
    checkpoint,
  }]
}

export function nextStepForCheckpoint(checkpoint: AgentReviewCheckpoint): string {
  switch (checkpoint) {
    case 'character_sheet':
      return 'scene start frames'
    case 'scene_sheet':
    case 'still':
      return 'the next start frame or video'
    case 'last_frame':
      return 'the next start frame or video'
    case 'video':
      return 'the next video'
    case 'place':
    case 'next_shot':
      return 'the next video'
    default:
      return 'the next start frame'
  }
}
