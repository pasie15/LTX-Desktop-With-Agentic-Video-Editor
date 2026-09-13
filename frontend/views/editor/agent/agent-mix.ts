export const AGENT_PICTURE_TRACK_INDEX = 0
export const AGENT_TITLE_TRACK_INDEX = 1
export const AGENT_VOICEOVER_TRACK_INDEX = 3
export const AGENT_MUSIC_TRACK_INDEX = 4
export const AGENT_VOICEOVER_MIX_LEVEL = 1
export const AGENT_MUSIC_MIX_LEVEL = 0.25
export const AGENT_DEFAULT_REF_STRENGTH = 0.35
export const AGENT_OPENING_TITLE_DURATION_S = 3

export function firstUnlockedTrackIndex(
  tracks: Array<{ kind?: string; locked?: boolean }> | undefined,
  kind: 'video' | 'audio',
  preferred: number,
): number {
  if (tracks?.[preferred] && tracks[preferred]?.kind === kind && !tracks[preferred]?.locked) {
    return preferred
  }
  const found = tracks?.findIndex(track => track.kind === kind && !track.locked) ?? -1
  return found >= 0 ? found : preferred
}
