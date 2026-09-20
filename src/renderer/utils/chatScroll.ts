export const SCROLL_BOTTOM_THRESHOLD_PX = 80

export function isNearBottom(
  container: { scrollHeight: number; scrollTop: number; clientHeight: number } | null | undefined,
  threshold = SCROLL_BOTTOM_THRESHOLD_PX
): boolean {
  if (!container) return true
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold
}

export type ScrollActionType = 'stream_delta' | 'user_send' | 'session_switch'

export interface ScrollDecision {
  shouldScroll: boolean
  behavior: 'auto' | 'smooth'
  force: boolean
}

export function decideScrollBehavior(action: ScrollActionType, isNearBottomState: boolean): ScrollDecision {
  if (action === 'user_send') {
    return { shouldScroll: true, behavior: 'smooth', force: true }
  }
  if (action === 'session_switch') {
    return { shouldScroll: true, behavior: 'auto', force: true }
  }
  // Stream delta: only scroll if user was near bottom, with 'auto' behavior to prevent jitter
  return {
    shouldScroll: isNearBottomState,
    behavior: 'auto',
    force: false
  }
}
