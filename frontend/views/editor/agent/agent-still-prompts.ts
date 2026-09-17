/** Z-Image follows the start of the prompt. Lead with framing or it paints another headshot. */

export const SCENE_STILL_LEAD =
  'Cinematic 16:9 production still, medium-wide shot, camera pulled back. '
  + 'A person stands or walks inside a real location. Head-to-knee or full body visible. '
  + 'Environment, wardrobe, and set dressing fill most of the frame. '

export const SCENE_STILL_TAIL =
  'Not a close-up. Not a studio headshot. Not a passport photo. Not a cropped face. Not a copy of a reference portrait.'

export const EMPTY_STILL_LEAD =
  'Cinematic 16:9 production still, wide establishing shot, camera pulled back. '
  + 'Location and atmosphere only. No people. No faces. '

export const EMPTY_STILL_TAIL =
  'Empty frame. No character. No portrait. No cropped face.'

export const LOOKBOOK_LEAD =
  'Full-body character reference sheet, 16:9 orthographic lookbook grid on a seamless studio backdrop. '
  + 'Panels: T-pose front, T-pose back, three-quarter standing, side profile. '
  + 'Entire figure visible from hair to shoes in every panel. Hands, shoes, and silhouette readable. '

export const LOOKBOOK_TAIL =
  'This is a design bible for later scene stills, not a video frame and not a facial close-up. '
  + 'Not a cropped headshot. Not a reprint of a portrait photograph.'

export function isLookbookPrompt(prompt: string): boolean {
  return /character sheet|lookbook|turnaround|costume bible|t-pose|reference sheet|orthographic lookbook|seamless studio backdrop/i.test(prompt)
}

/** Drop catalog language so a T-pose first-frame note can still become a scene still. */
export function stripLookbookLanguage(prompt: string): string {
  return prompt
    .replace(/character sheet|lookbook|turnaround|costume bible|reference sheet/gi, '')
    .replace(/\bt-poses?\b/gi, 'standing pose')
    .replace(/orthographic(?: lookbook)?|seamless studio backdrop|studio catalog/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isEmptyScenePrompt(prompt: string): boolean {
  return /do not show the protagonist|no people|no ken\b|no face|no faces|empty (river|bridge|frame)|environment only/i.test(prompt)
}

export function neutralizeStillCloseup(prompt: string): string {
  return prompt
    .replace(/\bclose-?ups?\b/gi, 'medium shot with the location visible')
    .replace(/\bclose three-quarter\b/gi, 'three-quarter figure in the location')
    .replace(/\bclose-medium\b/gi, 'medium shot in the location')
    .replace(/\bhero medium\b/gi, 'medium-wide in the location')
}

export function frameIdentityImagePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  if (isLookbookPrompt(trimmed)) {
    if (/^Full-body character reference sheet/i.test(trimmed)) return trimmed
    return `${LOOKBOOK_LEAD}${neutralizeStillCloseup(trimmed)} ${LOOKBOOK_TAIL}`
  }
  if (/^Cinematic 16:9 production still/i.test(trimmed)) return trimmed
  const body = neutralizeStillCloseup(trimmed)
  if (isEmptyScenePrompt(body)) {
    return `${EMPTY_STILL_LEAD}${body} ${EMPTY_STILL_TAIL}`
  }
  return `${SCENE_STILL_LEAD}${body} ${SCENE_STILL_TAIL}`
}

/** Video starts and scene stills. Never mint another lookbook as a frame. */
export function sceneStillPromptForVideo(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return frameIdentityImagePrompt(
      'The referenced character in a real cinematic location matching the scene. '
      + 'Full or three-quarter body, wardrobe from the character bible. '
      + 'Not a studio catalog and not a cropped face.',
    )
  }
  if (isLookbookPrompt(trimmed)) {
    const scene = stripLookbookLanguage(trimmed)
    return frameIdentityImagePrompt(
      scene
        || 'The referenced character in a real cinematic location matching the scene. '
          + 'Full or three-quarter body, wardrobe from the character bible. '
          + 'Not a studio catalog and not a cropped face.',
    )
  }
  return frameIdentityImagePrompt(trimmed)
}
