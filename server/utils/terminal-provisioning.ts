import type { ProviderId } from './session-store'
import { readStoredSession, writeStoredSession } from './session-store'
import { prepareClaudeHooks, providerSupportsCliHooks } from './cli-hooks'
import { buildProviderCommand } from './provider-command'
import { projectDir as defaultProjectDir, projectKey } from './project-dir'
import { createSessionWorktree, deleteSessionWorktree } from './worktree'
import { ensureTmuxSession } from './tmux'
import { sanitizeTmuxName } from './terminal-protocol'
import { startProviderSessionCapture } from './provider-session-capture'
import type { TerminalSession } from './terminal-session'

export type ProvisionedTerminal = {
  id: string
  provider: ProviderId
  tmuxName: string
  cwd: string
  cliBin: string
  tmuxCreated: boolean
  tmuxLaunchedAtMs: number
}

/** Provisions durable metadata, a managed worktree, and its tmux CLI process. */
export async function provisionTerminalSession(options: {
  sessionId?: string
  provider: ProviderId
  baseBranch?: string
  featureId?: string
  branch?: string
  allowCreate?: boolean
}): Promise<ProvisionedTerminal> {
  const id = options.sessionId || generateConversationId()
  const stored = await readStoredSession(id)
  const now = new Date().toISOString()
  const provider = stored?.provider || options.provider
  if (stored?.finalized) throw new Error('This conversation has been finalized')
  if (stored?.archived) throw new Error('This conversation has been archived')
  if (options.sessionId && !stored && options.allowCreate === false) {
    throw new Error(`Conversation ${options.sessionId} not found`)
  }
  const cliBin = buildProviderCommand(provider)
  const tmuxName = stored?.tmuxName || `${provider}-web-${projectKey()}-${sanitizeTmuxName(id)}`
  const projectDir = stored?.projectDir || defaultProjectDir()
  const worktree = stored ? null : await createSessionWorktree(
    projectDir, id, options.baseBranch, options.featureId, options.branch
  )
  const cwd = stored?.cwd || worktree!.worktreePath

  let tmuxCreated = false
  const tmuxLaunchedAtMs = Date.now()
  try {
    prepareCliHooksSafely(provider, cwd, id)
    tmuxCreated = await ensureTmuxSession(tmuxName, cwd, () =>
      resolveProviderLaunchCommand(provider, stored?.providerSessionId)
    )
    await writeStoredSession({
      ...stored,
      id,
      provider,
      tmuxName,
      cwd,
      cliBin,
      providerSessionId: stored?.providerSessionId,
      featureId: stored?.featureId || options.featureId,
      projectDir: stored?.projectDir || worktree?.projectDir,
      worktreeBranch: stored?.worktreeBranch || worktree?.branch,
      baseBranch: stored?.baseBranch || worktree?.baseBranch,
      createdAt: stored?.createdAt || now,
      updatedAt: now
    })
  } catch (error) {
    if (worktree) {
      await deleteSessionWorktree({
        projectDir: worktree.projectDir,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch
      }).catch(() => {})
    }
    throw error
  }

  return { id, provider, tmuxName, cwd, cliBin, tmuxCreated, tmuxLaunchedAtMs }
}

/** Recreates a missing tmux process for cached metadata and resumes capture. */
export async function reviveTerminalSession(session: TerminalSession): Promise<void> {
  const revivedAtMs = Date.now()
  const revived = await ensureTmuxSession(session.tmuxName, session.cwd, async () => {
    prepareCliHooksSafely(session.provider, session.cwd, session.id)
    const stored = await readStoredSession(session.id).catch(() => null)
    return resolveProviderLaunchCommand(session.provider, stored?.providerSessionId)
  })
  if (revived) startProviderSessionCapture(session.id, session.provider, session.cwd, revivedAtMs)
}

function prepareCliHooksSafely(provider: ProviderId, cwd: string, sessionId: string) {
  if (!providerSupportsCliHooks(provider)) return
  try {
    prepareClaudeHooks(cwd, sessionId)
  } catch (error) {
    console.error(`[terminal] failed to prepare CLI hooks for ${sessionId}:`, error)
  }
}

function resolveProviderLaunchCommand(provider: ProviderId, providerSessionId?: string | null) {
  try {
    return buildProviderCommand(provider, providerSessionId)
  } catch {
    return buildProviderCommand(provider)
  }
}

function generateConversationId() {
  return `conv-${Math.random().toString(36).slice(2, 12)}`
}
