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

export const EDIT_TOOL_NAMES = [
  'insert_assets',
  'overwrite_assets',
  'split_clips',
  'move_clips',
  'trim_clip',
  'delete_clips',
  'add_text',
  'add_subtitle',
  'set_clip_volume',
  'select_clips',
  'set_playhead',
  'create_timeline',
  'create_bin',
  'assign_assets_to_bin',
  'rename_bin',
  'undo',
] as const

export type AgentEditToolName = (typeof EDIT_TOOL_NAMES)[number]

export const GENERATE_TOOL_NAMES = [
  'generate_image',
  'generate_video',
  'fill_gap',
  'regenerate_clip',
  'enhance_prompt',
] as const

export type AgentGenerateToolName = (typeof GENERATE_TOOL_NAMES)[number]

export const ASSEMBLY_TOOL_NAMES = [
  'assemble_shots',
] as const

export type AgentAssemblyToolName = (typeof ASSEMBLY_TOOL_NAMES)[number]

export const IMPORT_TOOL_NAMES = [
  'import_media',
] as const

export type AgentImportToolName = (typeof IMPORT_TOOL_NAMES)[number]

export const REF_TOOL_NAMES = [
  'list_refs',
  'register_ref',
  'forget_ref',
] as const

export type AgentRefToolName = (typeof REF_TOOL_NAMES)[number]

export const SPEECH_TOOL_NAMES = [
  'generate_speech',
] as const

export type AgentSpeechToolName = (typeof SPEECH_TOOL_NAMES)[number]

export type AgentToolName =
  | AgentReadToolName
  | AgentEditToolName
  | AgentGenerateToolName
  | AgentAssemblyToolName
  | AgentImportToolName
  | AgentRefToolName
  | AgentSpeechToolName

export function isGenerateToolName(name: string): name is AgentGenerateToolName {
  return (GENERATE_TOOL_NAMES as readonly string[]).includes(name)
}

export function isAssemblyToolName(name: string): name is AgentAssemblyToolName {
  return (ASSEMBLY_TOOL_NAMES as readonly string[]).includes(name)
}

export function isImportToolName(name: string): name is AgentImportToolName {
  return (IMPORT_TOOL_NAMES as readonly string[]).includes(name)
}

export function isRefToolName(name: string): name is AgentRefToolName {
  return (REF_TOOL_NAMES as readonly string[]).includes(name)
}

export function isSpeechToolName(name: string): name is AgentSpeechToolName {
  return (SPEECH_TOOL_NAMES as readonly string[]).includes(name)
}

export function isSlotHoldingToolName(name: string): boolean {
  return isGenerateToolName(name) || isAssemblyToolName(name)
}

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

export const EDIT_TOOL_ALLOWED_KEYS: Record<AgentEditToolName, readonly string[]> = {
  insert_assets: ['assetIds', 'startTime', 'trackIndex'],
  overwrite_assets: ['assetIds', 'startTime', 'trackIndex'],
  split_clips: ['clipIds', 'time'],
  move_clips: ['clipIds', 'deltaTime', 'start', 'trackIndex'],
  trim_clip: ['id', 'start', 'duration', 'end'],
  delete_clips: ['clipIds', 'confirmed'],
  add_text: ['text', 'startTime', 'trackIndex', 'duration'],
  add_subtitle: ['text', 'startTime', 'endTime', 'trackIndex'],
  set_clip_volume: ['clipId', 'id', 'volume'],
  select_clips: ['clipIds'],
  set_playhead: ['time'],
  create_timeline: ['name'],
  create_bin: ['name'],
  assign_assets_to_bin: ['assetIds', 'binId'],
  rename_bin: ['binId', 'name'],
  undo: [],
}

export const GENERATE_TOOL_ALLOWED_KEYS: Record<AgentGenerateToolName, readonly string[]> = {
  generate_image: ['prompt', 'resolution', 'aspectRatio', 'destination', 'trackIndex', 'startTime', 'confirmed', 'referenceAssetId', 'refId', 'skipReview'],
  generate_video: ['prompt', 'model', 'duration', 'resolution', 'audio', 'imageAssetId', 'refId', 'destination', 'trackIndex', 'startTime', 'confirmed', 'skipReview'],
  fill_gap: ['prompt', 'model', 'duration', 'resolution', 'audio', 'imageAssetId', 'trackIndex', 'start', 'end', 'confirmed'],
  regenerate_clip: ['clipId', 'assetId', 'confirmed'],
  enhance_prompt: ['prompt', 'mediaType'],
}

export const ASSEMBLY_TOOL_ALLOWED_KEYS: Record<AgentAssemblyToolName, readonly string[]> = {
  assemble_shots: [
    'script',
    'shots',
    'kind',
    'destination',
    'trackIndex',
    'startTime',
    'model',
    'resolution',
    'audio',
    'skipStills',
    'confirmed',
    'confirmedMore',
    'voiceover',
    'voiceoverAssetId',
    'musicAssetId',
    'openingTitle',
    'title',
  ],
}

export const IMPORT_TOOL_ALLOWED_KEYS: Record<AgentImportToolName, readonly string[]> = {
  import_media: [
    'path',
    'paths',
    'type',
    'destination',
    'trackIndex',
    'startTime',
    'start',
    'end',
    'binId',
  ],
}

export const REF_TOOL_ALLOWED_KEYS: Record<AgentRefToolName, readonly string[]> = {
  list_refs: [],
  register_ref: ['name', 'assetId', 'role', 'id'],
  forget_ref: ['id', 'refId'],
}

export const SPEECH_TOOL_ALLOWED_KEYS: Record<AgentSpeechToolName, readonly string[]> = {
  generate_speech: ['text', 'voiceId', 'modelId', 'destination', 'trackIndex', 'startTime', 'confirmed'],
}

export const AGENT_TOOL_ALLOWED_KEYS: Record<AgentToolName, readonly string[]> = {
  ...READ_TOOL_ALLOWED_KEYS,
  ...EDIT_TOOL_ALLOWED_KEYS,
  ...GENERATE_TOOL_ALLOWED_KEYS,
  ...ASSEMBLY_TOOL_ALLOWED_KEYS,
  ...IMPORT_TOOL_ALLOWED_KEYS,
  ...REF_TOOL_ALLOWED_KEYS,
  ...SPEECH_TOOL_ALLOWED_KEYS,
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

export const EDIT_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'insert_assets',
    description: 'Ripple/append assets onto the active timeline. Uses playhead or track end if startTime is omitted. Audio assets default to the first unlocked audio track.',
    parameters: {
      type: 'object',
      required: ['assetIds'],
      properties: {
        assetIds: { type: 'array', items: { type: 'string' } },
        startTime: { type: 'number', description: 'Insert time in seconds' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'overwrite_assets',
    description: 'Replace the landing region with assets. Does not ripple later clips.',
    parameters: {
      type: 'object',
      required: ['assetIds'],
      properties: {
        assetIds: { type: 'array', items: { type: 'string' } },
        startTime: { type: 'number' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'split_clips',
    description: 'Split clips at a time in seconds. Defaults to the selection and the playhead.',
    parameters: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
        time: { type: 'number' },
      },
    },
  },
  {
    name: 'move_clips',
    description: 'Move clips by deltaTime seconds and/or to trackIndex. start is an absolute time for the earliest clip.',
    parameters: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
        deltaTime: { type: 'number' },
        start: { type: 'number' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'trim_clip',
    description: 'Set a clip start and/or duration (or end) in seconds.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        start: { type: 'number' },
        duration: { type: 'number' },
        end: { type: 'number' },
      },
    },
  },
  {
    name: 'delete_clips',
    description: 'Delete clips. Deleting 2+ clips requires confirmed=true after ask_user.',
    parameters: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
        confirmed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'add_text',
    description: 'Add a title/text clip on a video track.',
    parameters: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        startTime: { type: 'number' },
        trackIndex: { type: 'number' },
        duration: { type: 'number' },
      },
    },
  },
  {
    name: 'set_clip_volume',
    description: 'Set clip volume from 0 to 1. Use for a basic mix: voiceover near 1, background music around 0.25.',
    parameters: {
      type: 'object',
      required: ['volume'],
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string', description: 'Alias for clipId' },
        volume: { type: 'number', description: '0 silent, 1 full' },
      },
    },
  },
  {
    name: 'add_subtitle',
    description: 'Add a subtitle cue. Creates a subtitle track if needed.',
    parameters: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        startTime: { type: 'number' },
        endTime: { type: 'number' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'select_clips',
    description: 'Select clips by exact id. Pass [] to clear.',
    parameters: {
      type: 'object',
      required: ['clipIds'],
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'set_playhead',
    description: 'Move the playhead to a time in seconds.',
    parameters: {
      type: 'object',
      required: ['time'],
      properties: {
        time: { type: 'number' },
      },
    },
  },
  {
    name: 'create_timeline',
    description: 'Create a timeline and switch to it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'create_bin',
    description: 'Create an asset bin. Returns the new bin id.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'assign_assets_to_bin',
    description: 'Move assets into a bin. Omit binId to unassign.',
    parameters: {
      type: 'object',
      required: ['assetIds'],
      properties: {
        assetIds: { type: 'array', items: { type: 'string' } },
        binId: { type: 'string' },
      },
    },
  },
  {
    name: 'rename_bin',
    description: 'Rename a bin by exact id.',
    parameters: {
      type: 'object',
      required: ['binId', 'name'],
      properties: {
        binId: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'undo',
    description: 'Undo the last assistant edit only. Refuses if the user changed the document since.',
    parameters: { type: 'object', properties: {} },
  },
]

export const GENERATE_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'generate_image',
    description: 'Generate a still with Z-Image and add it to the project. Requires confirmed=true after the user accepts the proposal. Waits for the GPU slot instead of returning busy.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        resolution: { type: 'string', enum: ['1080p', '1440p', '2048p'] },
        aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] },
        destination: { type: 'string', enum: ['assets', 'playhead', 'gap', 'after_last'] },
        trackIndex: { type: 'number' },
        startTime: { type: 'number' },
        confirmed: { type: 'boolean' },
        referenceAssetId: { type: 'string', description: 'Existing still for img2img / IC-LoRA-style continuity' },
        refId: { type: 'string', description: 'Named ref from list_refs; resolved to an image asset' },
      },
    },
  },
  {
    name: 'generate_video',
    description: 'Generate an LTX video and add it to the project. Confirm first. Prefer a start still via imageAssetId (image-to-video). Waits for the GPU slot instead of returning busy.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', description: 'LTX pipeline id from list_generation_models, default fast' },
        duration: { type: 'number', description: 'Seconds. Default selected gap or 4.' },
        resolution: { type: 'string', description: 'Video resolution, default 540p preview' },
        audio: { type: 'boolean' },
        imageAssetId: { type: 'string', description: 'Exact still asset id for image-to-video' },
        refId: { type: 'string', description: 'Named character/object ref used as the i2v start still' },
        destination: { type: 'string', enum: ['assets', 'playhead', 'gap', 'after_last'] },
        trackIndex: { type: 'number' },
        startTime: { type: 'number' },
        confirmed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'fill_gap',
    description: 'Generate for the selected timeline gap and place the result there. Confirm first.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
        duration: { type: 'number' },
        resolution: { type: 'string' },
        audio: { type: 'boolean' },
        imageAssetId: { type: 'string' },
        trackIndex: { type: 'number' },
        start: { type: 'number' },
        end: { type: 'number' },
        confirmed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'regenerate_clip',
    description: 'Regenerate an existing clip from its stored generationParams. Confirm first.',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        assetId: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'enhance_prompt',
    description: 'Rewrite a generate prompt. Does not start a generate.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        mediaType: { type: 'string', enum: ['image', 'video'] },
      },
    },
  },
]

export const ASSEMBLY_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'assemble_shots',
    description: 'Default path for a short film, music video, narrative, commercial, montage, B-roll, or pasted script. Picture on V1, optional titles on V2, voiceover on A1, music on A2. Propose a 4–8 shot list, then generate still-then-video with a review pause after each still and placed shot unless approveAll is on. Pass voiceover text or voiceoverAssetId / musicAssetId. Use refId or imageAssetId on shots for character/object consistency. First call without confirmed unless approveAll. After Accept, retry with confirmed=true. After each still review, retry again.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Pasted script or scene list to parse into shots' },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            required: ['prompt'],
            properties: {
              id: { type: 'string' },
              prompt: { type: 'string' },
              duration: { type: 'number' },
              title: { type: 'string', description: 'Scene slug; placed as a text clip' },
              imageAssetId: { type: 'string', description: 'Reuse an existing still instead of generating one' },
              refId: { type: 'string', description: 'Named ref; img2img then i2v from the new still' },
              assetId: { type: 'string', description: 'Place this existing image, video, or audio asset instead of generating' },
              skipStill: { type: 'boolean' },
            },
          },
        },
        kind: { type: 'string', enum: ['script', 'broll', 'music_video', 'narrative'] },
        destination: { type: 'string', enum: ['assets', 'playhead', 'gap', 'after_last'] },
        trackIndex: { type: 'number' },
        startTime: { type: 'number' },
        model: { type: 'string' },
        resolution: { type: 'string' },
        audio: { type: 'boolean' },
        skipStills: { type: 'boolean' },
        confirmed: { type: 'boolean' },
        confirmedMore: { type: 'boolean', description: 'Required when the assembly exceeds 8 generate jobs' },
        voiceover: { type: 'string', description: 'Narration to synthesize with ElevenLabs and place on A1' },
        voiceoverAssetId: { type: 'string', description: 'Existing audio asset to place on A1' },
        musicAssetId: { type: 'string', description: 'Existing music asset to place on A2 at 0.25 volume' },
        openingTitle: { type: 'string', description: 'Opening title on V2' },
        title: { type: 'string', description: 'Alias for openingTitle' },
      },
    },
  },
]

export const REF_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'list_refs',
    description: 'List named character, object, location, and style stills in the project ref library.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'register_ref',
    description: 'Register an image asset as a reusable character/object/location/style ref for shot continuity.',
    parameters: {
      type: 'object',
      required: ['name', 'assetId'],
      properties: {
        name: { type: 'string' },
        assetId: { type: 'string' },
        role: { type: 'string', enum: ['character', 'object', 'location', 'style'] },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'forget_ref',
    description: 'Remove a named ref from the library. Does not delete the asset.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        refId: { type: 'string' },
      },
    },
  },
]

export const SPEECH_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'generate_speech',
    description: 'Generate ElevenLabs speech, add it as an audio asset, and place it on A1 (voiceover). Requires an ElevenLabs key in Settings. Confirm first.',
    parameters: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        voiceId: { type: 'string' },
        modelId: { type: 'string' },
        destination: { type: 'string', enum: ['assets', 'playhead'] },
        trackIndex: { type: 'number' },
        startTime: { type: 'number' },
        confirmed: { type: 'boolean' },
      },
    },
  },
]

export const IMPORT_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'import_media',
    description: 'Copy user-provided image, video, music, or audio files into the project from filesystem paths. Then insert_assets to place them, or pass destination to place now.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'One filesystem path' },
        paths: { type: 'array', items: { type: 'string' }, description: 'One or more filesystem paths' },
        type: { type: 'string', enum: ['image', 'video', 'audio'] },
        destination: { type: 'string', enum: ['assets', 'playhead', 'gap', 'after_last'] },
        trackIndex: { type: 'number' },
        startTime: { type: 'number' },
        start: { type: 'number', description: 'Gap start in seconds when destination is gap' },
        end: { type: 'number', description: 'Gap end in seconds when destination is gap' },
        binId: { type: 'string' },
      },
    },
  },
]

export const AGENT_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  ...READ_TOOL_DEFINITIONS,
  ...EDIT_TOOL_DEFINITIONS,
  ...GENERATE_TOOL_DEFINITIONS,
  ...ASSEMBLY_TOOL_DEFINITIONS,
  ...IMPORT_TOOL_DEFINITIONS,
  ...REF_TOOL_DEFINITIONS,
  ...SPEECH_TOOL_DEFINITIONS,
]

function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`
}

function clipCountFromArgs(args?: Record<string, unknown>): number | null {
  if (!args) return null
  if (Array.isArray(args.clipIds)) return args.clipIds.length
  if (Array.isArray(args.assetIds)) return args.assetIds.length
  return null
}

export function toolRowLabel(name: string, args?: Record<string, unknown>): string {
  const count = clipCountFromArgs(args)
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
    case 'insert_assets':
      return count != null ? `Insert ${countLabel(count, 'asset', 'assets')}` : 'Insert assets'
    case 'overwrite_assets':
      return count != null ? `Overwrite ${countLabel(count, 'asset', 'assets')}` : 'Overwrite assets'
    case 'split_clips':
      return count != null ? `Split ${countLabel(count, 'clip', 'clips')}` : 'Split clips'
    case 'move_clips':
      return count != null ? `Move ${countLabel(count, 'clip', 'clips')}` : 'Move clips'
    case 'trim_clip':
      return 'Trim clip'
    case 'delete_clips':
      return count != null ? `Delete ${countLabel(count, 'clip', 'clips')}` : 'Delete clips'
    case 'add_text':
      return 'Add text'
    case 'add_subtitle':
      return 'Add subtitle'
    case 'set_clip_volume':
      return 'Set clip volume'
    case 'select_clips':
      return count != null ? `Select ${countLabel(count, 'clip', 'clips')}` : 'Select clips'
    case 'set_playhead':
      return 'Set playhead'
    case 'create_timeline':
      return 'Create timeline'
    case 'create_bin':
      return 'Create bin'
    case 'assign_assets_to_bin':
      return 'Assign assets to bin'
    case 'rename_bin':
      return 'Rename bin'
    case 'undo':
      return 'Undo assistant edit'
    case 'generate_image':
      return 'Generate image'
    case 'generate_video': {
      const duration = typeof args?.duration === 'number' ? args.duration : null
      return duration != null ? `Generate ${duration}s preview` : 'Generate video'
    }
    case 'fill_gap':
      return 'Fill gap'
    case 'regenerate_clip':
      return 'Regenerate clip'
    case 'enhance_prompt':
      return 'Enhance prompt'
    case 'assemble_shots': {
      const shots = Array.isArray(args?.shots) ? args.shots.length : null
      return shots != null ? `Assemble ${shots} shots` : 'Assemble shots'
    }
    case 'import_media': {
      const paths = Array.isArray(args?.paths) ? args.paths.length : typeof args?.path === 'string' ? 1 : null
      return paths != null ? `Import ${countLabel(paths, 'file', 'files')}` : 'Import media'
    }
    case 'list_refs':
      return 'List refs'
    case 'register_ref':
      return 'Register ref'
    case 'forget_ref':
      return 'Forget ref'
    case 'generate_speech':
      return 'Generate speech'
    default:
      return name
  }
}
