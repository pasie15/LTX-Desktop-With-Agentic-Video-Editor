export interface AgentStarterPrompt {
  id: string
  label: string
  composerText: string
  autoSendWhenGapSelected?: boolean
}

export const AGENT_STARTER_PROMPTS: readonly AgentStarterPrompt[] = [
  {
    id: 'preview-video',
    label: 'Generate an LTX preview video of …',
    composerText: 'Generate an LTX preview video of ',
  },
  {
    id: 'fill-gap',
    label: 'Fill the selected gap',
    composerText: 'Fill the selected gap',
    autoSendWhenGapSelected: true,
  },
  {
    id: 'b-roll',
    label: 'Generate B-roll for this timeline',
    composerText: 'Generate B-roll for this timeline. Propose a shot list, then generate and place the shots in order.',
  },
  {
    id: 'assemble-script',
    label: 'Assemble this script on the timeline',
    composerText: 'Assemble this script on the timeline:\n\n',
  },
  {
    id: 'short-film',
    label: 'Make a short film about …',
    composerText: 'Create a short film about ',
  },
  {
    id: 'titles',
    label: 'Add titles / subtitles',
    composerText: 'Add titles / subtitles',
  },
  {
    id: 'voiceover-music',
    label: 'Add voiceover and music',
    composerText: 'Add a voiceover and background music. Generate or import the VO onto A1 and place music on A2 under the picture, then mix music down.',
  },
  {
    id: 'organize-bins',
    label: 'Organize assets into bins',
    composerText: 'Organize assets into bins',
  },
]

export function resolveStarterComposerText(starter: AgentStarterPrompt): string {
  return starter.composerText
}

export function shouldAutoSendStarter(starter: AgentStarterPrompt, hasSelectedGap: boolean): boolean {
  return Boolean(starter.autoSendWhenGapSelected && hasSelectedGap)
}
