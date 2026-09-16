import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Canonical root of the project this server instance is scoped to.
 *
 * Resolution order: `SIDINGS_PROJECT_DIR` → `CLAUDE_WORKDIR` → the process's
 * current working directory. The result is resolved to an absolute path.
 */
export function projectDir(): string {
  return resolve(process.env.SIDINGS_PROJECT_DIR || process.env.CLAUDE_WORKDIR || process.cwd())
}

/**
 * Short, filesystem- and tmux-safe key identifying the project this instance
 * serves. Every per-user shared resource — the session store, the managed
 * worktree root, and tmux session names — is namespaced by this key so two
 * instances pointed at different directories never see, list, or reap each
 * other's state. Derived from the resolved project path, so relaunching from
 * the same directory yields the same key.
 */
export function projectKey(): string {
  return createHash('sha256').update(projectDir()).digest('hex').slice(0, 12)
}

/** Base of all sidings state: `SIDINGS_V2_DIR` or `~/.sidings/v2`. */
function storeBase(): string {
  return process.env.SIDINGS_V2_DIR || join(homedir(), '.sidings', 'v2')
}

/** Per-project store root: `<base>/projects/<projectKey>`. */
export function projectStoreRoot(): string {
  return join(storeBase(), 'projects', projectKey())
}

/** Per-project managed worktree root: `<projectStoreRoot>/tmp`. */
export function projectWorktreeRoot(): string {
  return join(projectStoreRoot(), 'tmp')
}
