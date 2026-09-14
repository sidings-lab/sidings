import type { Peer } from 'crossws'
import { readStoredSession, type ProviderId } from '../utils/session-store'
import { recordTerminalAttach } from '../utils/runtime-activity'
import { followSessionBranch } from '../utils/session-integration'
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  clampTerminalDimension,
  normalizeTerminalSessionId
} from '../utils/terminal-protocol'
import { startProviderSessionCapture } from '../utils/provider-session-capture'
import {
  detachTerminalPeer,
  disposeTerminalSessionRuntime,
  spawnTerminalPeerClient,
  type TerminalSession
} from '../utils/terminal-session'
import { createTerminalWebSocketHandlers } from '../utils/terminal-websocket'
import { provisionTerminalSession, reviveTerminalSession } from '../utils/terminal-provisioning'
import { appendTerminalOutput, createTerminalRuntime } from '../utils/terminal-runtime'

const DEFAULT_COLS = DEFAULT_TERMINAL_COLS
const DEFAULT_ROWS = DEFAULT_TERMINAL_ROWS
const SESSION_TTL_MS = Number(
  process.env.TERMINAL_SESSION_TTL_MS
  || process.env.CLAUDE_SESSION_TTL_MS
  || 30 * 60 * 1000
)
const sessions = new Map<string, TerminalSession>()
const sessionCreations = new Map<string, Promise<TerminalSession>>()

export type AutomationConversation = {
  id: string
  provider: ProviderId
  tmuxName: string
  cwd: string
}

/** Creates a managed conversation without attaching a browser terminal. */
export async function createAutomationConversation(options: {
  provider?: ProviderId
  branch?: string
  baseBranch?: string
  featureId?: string
} = {}): Promise<AutomationConversation> {
  const session = await getOrCreateSession(
    undefined,
    options.provider,
    options.baseBranch,
    options.featureId,
    options.branch,
    true
  )
  if (session.peers.size === 0) scheduleSessionCleanup(session)
  return {
    id: session.id,
    provider: session.provider,
    tmuxName: session.tmuxName,
    cwd: session.cwd
  }
}

export default defineWebSocketHandler(createTerminalWebSocketHandlers({
  attach: attachSession,
  sessionForPeer: getPeerSession,
  detach: detachPeer
}))

async function attachSession(
  peer: Peer,
  requestedSessionId?: string,
  requestedProvider?: ProviderId,
  requestedBaseBranch?: string,
  requestedFeatureId?: string,
  requestedCols?: number,
  requestedRows?: number,
  create?: boolean
) {
  const id = normalizeTerminalSessionId(requestedSessionId)
  if (requestedSessionId && !id) throw new Error('Invalid session ID')
  if (!id && !create) throw new Error('Session ID is required to attach')
  const session = await getOrCreateSession(
    id,
    requestedProvider,
    requestedBaseBranch,
    requestedFeatureId,
    undefined,
    Boolean(create)
  )

  await reviveTerminalSession(session)

  session.cols = clampTerminalDimension(requestedCols, session.cols)
  session.rows = clampTerminalDimension(requestedRows, session.rows)

  const previous = session.peers.get(peer)
  if (previous) {
    session.peers.delete(peer)
    try { previous.kill() } catch {}
  }

  spawnTerminalPeerClient(session, peer, { appendOutput: appendTerminalOutput, onEmpty: scheduleSessionCleanup })
  peer.context.sessionId = session.id
  recordTerminalAttach(session.id)

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer)
    session.cleanupTimer = null
  }

  return session
}

async function getOrCreateSession(
  id?: string | null,
  provider?: ProviderId,
  baseBranch?: string,
  featureId?: string,
  branch?: string,
  allowCreate = false
) {
  if (!id) {
    if (!allowCreate) throw new Error('Session ID is required to attach')
    return createSession(undefined, provider, baseBranch, featureId, branch, true)
  }
  const existing = sessions.get(id)
  if (existing) return existing
  const pending = sessionCreations.get(id)
  if (pending) return pending
  const stored = await readStoredSession(id)
  if (!stored) {
    if (!allowCreate) throw new Error(`Conversation ${id} not found`)
  } else if (stored.archived) {
    throw new Error(`Conversation ${id} is archived`)
  } else if (stored.finalized) {
    throw new Error('This conversation has been finalized')
  }
  const creation = createSession(id, provider, baseBranch, featureId, branch, allowCreate)
  sessionCreations.set(id, creation)
  try {
    return await creation
  } finally {
    if (sessionCreations.get(id) === creation) sessionCreations.delete(id)
  }
}

async function createSession(
  requestedSessionId?: string,
  requestedProvider: ProviderId = 'claude',
  requestedBaseBranch?: string,
  requestedFeatureId?: string,
  requestedBranch?: string,
  allowCreate = false
): Promise<TerminalSession> {
  const { id, provider, tmuxName, cwd, cliBin, tmuxCreated, tmuxLaunchedAtMs } = await provisionTerminalSession({
    sessionId: requestedSessionId,
    provider: requestedProvider,
    baseBranch: requestedBaseBranch,
    featureId: requestedFeatureId,
    branch: requestedBranch,
    allowCreate
  })

  let session!: TerminalSession
  const runtime = createTerminalRuntime({ id, provider, cwd, tmuxName, getSession: () => session })
  session = {
    id,
    provider,
    tmuxName,
    cwd,
    cliBin,
    peers: new Map(),
    loggerPeer: null,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cleanupTimer: null,
    turnMonitor: runtime.turnMonitor,
    hookMonitor: runtime.hookMonitor,
    gitWatcher: runtime.gitWatcher,
    idleCommitTimer: null
  }

  session.idleCommitTimer = runtime.startIdleBackstop(session)

  sessions.set(id, session)

  // The HEAD watcher only starts here, and its first read is a baseline — so a
  // branch the CLI switched to while nothing was attached (tmux keeps running
  // detached) would go unnoticed. Reconcile once on attach.
  await followSessionBranch(id).catch(() => {})

  // Capture the provider-side conversation id in the background so the
  // conversation can be resumed if the freshly launched tmux session dies.
  if (tmuxCreated) startProviderSessionCapture(id, provider, cwd, tmuxLaunchedAtMs)

  return session
}

function detachPeer(peer: Peer) {
  const session = getPeerSession(peer)
  if (!session) return

  if (detachTerminalPeer(session, peer)) scheduleSessionCleanup(session)
}

function scheduleSessionCleanup(session: TerminalSession) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  // The tmux session (and the CLI inside it) keeps running detached; only
  // the in-memory bookkeeping expires. Attaching later revives it.
  session.cleanupTimer = setTimeout(() => {
    if (session.peers.size > 0) return
    disposeTerminalSessionRuntime(session)
    sessions.delete(session.id)
  }, SESSION_TTL_MS)
}

function getPeerSession(peer: Peer) {
  const sessionId = peer.context.sessionId
  if (typeof sessionId !== 'string') return null
  return sessions.get(sessionId) || null
}
