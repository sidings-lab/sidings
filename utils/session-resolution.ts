import type { SessionListItem } from '~/types/session'

export type InitialSessionResolution =
  | { action: 'connect'; sessionId: string }
  | { action: 'select'; sessionId: string }
  | { action: 'selectArchived'; session: SessionListItem }
  | { action: 'idle' }

/**
 * Resolves which conversation to display or connect on page initialization.
 * Prevents phantom conversation creation when stored session IDs are stale,
 * deleted, archived, or when active sessions list is empty.
 */
export function resolveInitialSessionAction(
  storedId: string | undefined | null,
  activeSessions: SessionListItem[],
  archivedSessions: SessionListItem[]
): InitialSessionResolution {
  const normalizedStored = storedId?.trim() || undefined
  const activeMatch = normalizedStored ? activeSessions.find((s) => s.id === normalizedStored) : undefined

  if (activeMatch) {
    return activeMatch.finalized
      ? { action: 'select', sessionId: activeMatch.id }
      : { action: 'connect', sessionId: activeMatch.id }
  }

  const archivedMatch = normalizedStored ? archivedSessions.find((s) => s.id === normalizedStored) : undefined
  if (archivedMatch) {
    return { action: 'selectArchived', session: archivedMatch }
  }

  const firstActive = activeSessions[0]
  if (firstActive) {
    return firstActive.finalized
      ? { action: 'select', sessionId: firstActive.id }
      : { action: 'connect', sessionId: firstActive.id }
  }

  return { action: 'idle' }
}
