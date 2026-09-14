import type { ProviderId } from '~/types/session'

export type TerminalMessage = {
  type?: string
  data?: string
  sessionId?: string
  create?: boolean
  provider?: ProviderId
  baseBranch?: string
  featureId?: string
  cols?: number
  rows?: number
}

export type TerminalControlMessage =
  | { type: 'hello' }
  | { type: 'attached', sessionId: string }
  | { type: 'git-changed' }
