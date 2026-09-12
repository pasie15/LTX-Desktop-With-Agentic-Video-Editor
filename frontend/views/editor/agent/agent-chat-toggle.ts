export function agentChatToggleCopy(open: boolean): {
  pressed: boolean
  visibleLabel: string
  actionLabel: string
} {
  return {
    pressed: open,
    visibleLabel: 'Agent',
    actionLabel: open ? 'Hide Agent' : 'Show Agent',
  }
}
