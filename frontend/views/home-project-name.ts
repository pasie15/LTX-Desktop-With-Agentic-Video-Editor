export const DEFAULT_PROJECT_NAME = 'Untitled Project'

export function nextUntitledProjectName(existing: readonly string[]): string {
  const taken = new Set(existing.map(name => name.trim().toLowerCase()).filter(Boolean))
  if (!taken.has(DEFAULT_PROJECT_NAME.toLowerCase())) return DEFAULT_PROJECT_NAME
  let index = 2
  while (taken.has(`${DEFAULT_PROJECT_NAME} ${index}`.toLowerCase())) {
    index += 1
  }
  return `${DEFAULT_PROJECT_NAME} ${index}`
}

export function resolveNewProjectName(value: string, existing: readonly string[]): string {
  const trimmed = value.trim()
  return trimmed || nextUntitledProjectName(existing)
}
