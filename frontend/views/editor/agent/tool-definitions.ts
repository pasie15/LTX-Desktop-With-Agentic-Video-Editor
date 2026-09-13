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
  'set_clip_speed',
  'slip_clip',
  'slide_clip',
  'duplicate_clips',
  'add_track',
  'delete_track',
  'rename_track',
  'toggle_track_lock',
  'toggle_track_mute',
  'set_clip_opacity',
  'toggle_clip_mute',
  'toggle_clip_reverse',
  'add_cross_dissolve',
  'remove_cross_dissolve',
  'switch_timeline',
  'rename_timeline',
  'delete_timeline',
  'duplicate_timeline',
  'set_in_point',
  'set_out_point',
  'clear_in_out',
  'update_subtitle',
  'delete_subtitle',
  'add_adjustment_layer',
  'unlink_clip_group',
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

export const NARRATIVE_TOOL_NAMES = [
  'plan_edit',
  'check_cut',
  'sync_narration',
] as const

export type AgentNarrativeToolName = (typeof NARRATIVE_TOOL_NAMES)[number]

export type AgentToolName =
  | AgentReadToolName
  | AgentEditToolName
  | AgentGenerateToolName
  | AgentAssemblyToolName
  | AgentImportToolName
  | AgentRefToolName
  | AgentSpeechToolName
  | AgentNarrativeToolName

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

export function isNarrativeToolName(name: string): name is AgentNarrativeToolName {
  return (NARRATIVE_TOOL_NAMES as readonly string[]).includes(name)
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
  set_clip_speed: ['clipId', 'id', 'speed'],
  slip_clip: ['clipId', 'id', 'deltaTime'],
  slide_clip: ['clipId', 'id', 'deltaTime'],
  duplicate_clips: ['clipIds'],
  add_track: ['kind'],
  delete_track: ['trackId', 'trackIndex'],
  rename_track: ['trackId', 'trackIndex', 'name'],
  toggle_track_lock: ['trackId', 'trackIndex'],
  toggle_track_mute: ['trackId', 'trackIndex'],
  set_clip_opacity: ['clipId', 'id', 'opacity'],
  toggle_clip_mute: ['clipId', 'id'],
  toggle_clip_reverse: ['clipId', 'id'],
  add_cross_dissolve: ['leftClipId', 'rightClipId'],
  remove_cross_dissolve: ['leftClipId', 'rightClipId'],
  switch_timeline: ['timelineId', 'id'],
  rename_timeline: ['timelineId', 'id', 'name'],
  delete_timeline: ['timelineId', 'id', 'confirmed'],
  duplicate_timeline: ['timelineId', 'id'],
  set_in_point: ['time'],
  set_out_point: ['time'],
  clear_in_out: [],
  update_subtitle: ['id', 'subtitleId', 'text', 'start', 'end', 'startTime', 'endTime'],
  delete_subtitle: ['id', 'subtitleId'],
  add_adjustment_layer: ['startTime', 'trackIndex', 'duration'],
  unlink_clip_group: ['clipId', 'id'],
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

export const NARRATIVE_TOOL_ALLOWED_KEYS: Record<AgentNarrativeToolName, readonly string[]> = {
  plan_edit: ['goal', 'brief', 'shots', 'voStrategy', 'voiceover', 'refs', 'titles', 'mix', 'timing', 'checks'],
  check_cut: [],
  sync_narration: [],
}

export const AGENT_TOOL_ALLOWED_KEYS: Record<AgentToolName, readonly string[]> = {
  ...READ_TOOL_ALLOWED_KEYS,
  ...EDIT_TOOL_ALLOWED_KEYS,
  ...GENERATE_TOOL_ALLOWED_KEYS,
  ...ASSEMBLY_TOOL_ALLOWED_KEYS,
  ...IMPORT_TOOL_ALLOWED_KEYS,
  ...REF_TOOL_ALLOWED_KEYS,
  ...SPEECH_TOOL_ALLOWED_KEYS,
  ...NARRATIVE_TOOL_ALLOWED_KEYS,
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
  {
    name: 'set_clip_speed',
    description: 'Set clip playback speed. Use with trim_clip when fitting picture to voiceover (0.8–1.25 is the safe narrative range).',
    parameters: {
      type: 'object',
      required: ['speed'],
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
        speed: { type: 'number', description: '1 is normal. 0.8 slower / longer, 1.25 faster / shorter.' },
      },
    },
  },
  {
    name: 'slip_clip',
    description: 'Slip the source window of a clip without moving it on the timeline.',
    parameters: {
      type: 'object',
      required: ['deltaTime'],
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
        deltaTime: { type: 'number' },
      },
    },
  },
  {
    name: 'slide_clip',
    description: 'Slide a clip earlier or later by deltaTime seconds.',
    parameters: {
      type: 'object',
      required: ['deltaTime'],
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
        deltaTime: { type: 'number' },
      },
    },
  },
  {
    name: 'duplicate_clips',
    description: 'Duplicate clips and place the copies after the originals.',
    parameters: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'add_track',
    description: 'Add a video or audio track.',
    parameters: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['video', 'audio'] },
      },
    },
  },
  {
    name: 'delete_track',
    description: 'Delete a track and the clips on it. Prefer trackId from get_timeline.',
    parameters: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'rename_track',
    description: 'Rename a track.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        trackId: { type: 'string' },
        trackIndex: { type: 'number' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'toggle_track_lock',
    description: 'Lock or unlock a track.',
    parameters: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'toggle_track_mute',
    description: 'Mute or unmute a track.',
    parameters: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        trackIndex: { type: 'number' },
      },
    },
  },
  {
    name: 'set_clip_opacity',
    description: 'Set clip opacity from 0 to 100.',
    parameters: {
      type: 'object',
      required: ['opacity'],
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
        opacity: { type: 'number' },
      },
    },
  },
  {
    name: 'toggle_clip_mute',
    description: 'Mute or unmute one clip.',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'toggle_clip_reverse',
    description: 'Reverse a clip.',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'add_cross_dissolve',
    description: 'Add a cross-dissolve between two neighboring clips.',
    parameters: {
      type: 'object',
      required: ['leftClipId', 'rightClipId'],
      properties: {
        leftClipId: { type: 'string' },
        rightClipId: { type: 'string' },
      },
    },
  },
  {
    name: 'remove_cross_dissolve',
    description: 'Remove a cross-dissolve between two clips.',
    parameters: {
      type: 'object',
      required: ['leftClipId', 'rightClipId'],
      properties: {
        leftClipId: { type: 'string' },
        rightClipId: { type: 'string' },
      },
    },
  },
  {
    name: 'switch_timeline',
    description: 'Switch the active timeline.',
    parameters: {
      type: 'object',
      properties: {
        timelineId: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'rename_timeline',
    description: 'Rename a timeline. Defaults to the active timeline.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        timelineId: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'delete_timeline',
    description: 'Delete a timeline. Requires confirmed=true unless Approve all is on.',
    parameters: {
      type: 'object',
      properties: {
        timelineId: { type: 'string' },
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'duplicate_timeline',
    description: 'Duplicate a timeline and switch to the copy.',
    parameters: {
      type: 'object',
      properties: {
        timelineId: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'set_in_point',
    description: 'Set the timeline In mark. Defaults to the playhead.',
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'number' },
      },
    },
  },
  {
    name: 'set_out_point',
    description: 'Set the timeline Out mark. Defaults to the playhead.',
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'number' },
      },
    },
  },
  {
    name: 'clear_in_out',
    description: 'Clear In and Out marks.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'update_subtitle',
    description: 'Change subtitle text and/or start/end times.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subtitleId: { type: 'string' },
        text: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
        startTime: { type: 'number' },
        endTime: { type: 'number' },
      },
    },
  },
  {
    name: 'delete_subtitle',
    description: 'Delete a subtitle cue by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subtitleId: { type: 'string' },
      },
    },
  },
  {
    name: 'add_adjustment_layer',
    description: 'Add an adjustment layer clip on a video track.',
    parameters: {
      type: 'object',
      properties: {
        startTime: { type: 'number' },
        trackIndex: { type: 'number' },
        duration: { type: 'number' },
      },
    },
  },
  {
    name: 'unlink_clip_group',
    description: 'Unlink a clip from its group (A/V unlink).',
    parameters: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        id: { type: 'string' },
      },
    },
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
    description: 'Default path for a short film, music video, narrative, commercial, montage, B-roll, or pasted script. Call plan_edit first (Approve all does not skip planning). Picture on V1, titles on V2, voiceover on A1, music on A2. Voiceover duration drives picture: shots are sized to cover VO, then sync_narration / check_cut after place. Still-then-video with a review pause after each still unless approveAll. When the user already supplied a subject still or song, pass imageAssetId / musicAssetId — do not generate replacement stills. Pass voiceover text or voiceoverAssetId / musicAssetId. Use refId or imageAssetId for continuity.',
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
    description: 'Generate ElevenLabs speech, add it as an audio asset, and place it on A1 (voiceover). Returns measured duration. After speech + picture exist, check_cut / sync_narration so VO and picture match. Confirm first.',
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

export const NARRATIVE_TOOL_DEFINITIONS: AgentToolDeclaration[] = [
  {
    name: 'plan_edit',
    description: 'Internal plan-then-execute step. Analyze the brief, timeline, assets, refs, and selection, then record goal, shots, voStrategy, refs, titles, mix, timing, and checks. Required before assemble_shots / multi-shot generate. Approve all does not skip this — it only skips asking the user. Does not mutate the timeline.',
    parameters: {
      type: 'object',
      required: ['goal'],
      properties: {
        goal: { type: 'string' },
        brief: { type: 'string' },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              prompt: { type: 'string' },
              duration: { type: 'number' },
              title: { type: 'string' },
            },
          },
        },
        voStrategy: { type: 'string' },
        voiceover: { type: 'string' },
        refs: { type: 'array', items: { type: 'string' } },
        titles: { type: 'string' },
        mix: { type: 'string' },
        timing: { type: 'string', description: 'How VO duration will drive or be driven by picture' },
        checks: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'check_cut',
    description: 'Measure picture span vs A1 voiceover (and A2 music). Returns durations, gaps, mismatches, and suggested NLE fixes. Call after place. If mismatches exist, sync_narration or trim/extend/split/speed/generate extra until ok.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'sync_narration',
    description: 'Fit picture to voiceover duration. Extends or trims the last picture clip, then speeds within 0.8–1.25 if needed. Do not leave a 10s VO on 4s of picture. Returns the new check_cut. If still short, generate extra shots.',
    parameters: { type: 'object', properties: {} },
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
  ...NARRATIVE_TOOL_DEFINITIONS,
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
    case 'plan_edit':
      return 'Plan edit'
    case 'check_cut':
      return 'Check cut'
    case 'sync_narration':
      return 'Sync narration'
    case 'set_clip_speed':
      return 'Set clip speed'
    case 'slip_clip':
      return 'Slip clip'
    case 'slide_clip':
      return 'Slide clip'
    case 'duplicate_clips':
      return count != null ? `Duplicate ${countLabel(count, 'clip', 'clips')}` : 'Duplicate clips'
    case 'add_track':
      return 'Add track'
    case 'delete_track':
      return 'Delete track'
    case 'rename_track':
      return 'Rename track'
    case 'toggle_track_lock':
      return 'Toggle track lock'
    case 'toggle_track_mute':
      return 'Toggle track mute'
    case 'set_clip_opacity':
      return 'Set clip opacity'
    case 'toggle_clip_mute':
      return 'Toggle clip mute'
    case 'toggle_clip_reverse':
      return 'Toggle clip reverse'
    case 'add_cross_dissolve':
      return 'Add cross dissolve'
    case 'remove_cross_dissolve':
      return 'Remove cross dissolve'
    case 'switch_timeline':
      return 'Switch timeline'
    case 'rename_timeline':
      return 'Rename timeline'
    case 'delete_timeline':
      return 'Delete timeline'
    case 'duplicate_timeline':
      return 'Duplicate timeline'
    case 'set_in_point':
      return 'Set in point'
    case 'set_out_point':
      return 'Set out point'
    case 'clear_in_out':
      return 'Clear in/out'
    case 'update_subtitle':
      return 'Update subtitle'
    case 'delete_subtitle':
      return 'Delete subtitle'
    case 'add_adjustment_layer':
      return 'Add adjustment layer'
    case 'unlink_clip_group':
      return 'Unlink clip group'
    default:
      return name
  }
}
