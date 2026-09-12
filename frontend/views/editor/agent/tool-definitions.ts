import type { AgentToolDeclaration } from './agent-types.ts'

export const READ_TOOL_NAMES = [
  'get_project_overview',
  'get_timeline',
  'get_assets',
  'get_selection',
  'get_clip',
  'get_asset',
  'list_generation_models',
  'ask_user',
] as const

export type AgentReadToolName = (typeof READ_TOOL_NAMES)[number]

export const READ_TOOL_ALLOWED_KEYS: Record<AgentReadToolName, readonly string[]> = {
  get_project_overview: [],
  get_timeline: ['start', 'end'],
  get_assets: ['query', 'type', 'binId'],
  get_selection: [],
  get_clip: ['id'],
  get_asset: ['id'],
  list_generation_models: [],
  ask_user: ['questions'],
}

export const READ_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'get_project_overview',
    description: 'Project name, asset counts, and timeline summaries.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_timeline',
    description: 'Active timeline tracks, clips, gaps, and duration. Optional start/end window in seconds.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'number', description: 'Window start in seconds' },
        end: { type: 'number', description: 'Window end in seconds' },
      },
    },
  },
  {
    name: 'get_assets',
    description: 'Assets, bins, generation prompts, and favorites. Filter by query, type, or binId.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', enum: ['image', 'video', 'audio', 'adjustment'] },
        binId: { type: 'string' },
      },
    },
  },
  {
    name: 'get_selection',
    description: 'Selected clips, selected gap, playhead, and in/out marks.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_clip',
    description: 'Full clip record by exact id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'get_asset',
    description: 'Full asset record by exact id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_generation_models',
    description: 'Legal LTX video models with resolutions and durations.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ask_user',
    description: 'Ask a blocking production choice. Pause until the user answers.',
    parameters: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'prompt', 'kind'],
            properties: {
              id: { type: 'string' },
              prompt: { type: 'string' },
              kind: { type: 'string', enum: ['choice', 'text'] },
              options: { type: 'array', items: { type: 'string' } },
              allowMultiple: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
]

export function toolRowLabel(name: string): string {
  switch (name) {
    case 'get_project_overview':
      return 'Read project'
    case 'get_timeline':
      return 'Read timeline'
    case 'get_assets':
      return 'Read assets'
    case 'get_selection':
      return 'Read selection'
    case 'get_clip':
      return 'Read clip'
    case 'get_asset':
      return 'Read asset'
    case 'list_generation_models':
      return 'List generation models'
    case 'ask_user':
      return 'Asked a question'
    default:
      return name
  }
}
