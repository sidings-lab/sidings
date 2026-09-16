/**
 * One-time relocation of the on-disk state directory from `~/.spec-cat` to
 * `~/.sidings`.
 *
 * Everything here is synchronous on purpose. Nitro invokes plugins in filename
 * order and does NOT await them, so the only way to guarantee the store has
 * reached its final path before boot recovery reads it is to finish the move
 * inside a single synchronous plugin call. Recovery that observes an empty
 * store treats this project's live tmux sessions as orphans and kills them.
 *
 * Moving the directory invalidates two kinds of absolute path recorded
 * elsewhere, so both are repaired as part of the move:
 *
 * - Stored session records embed the worktree `cwd` under the old root.
 * - Git records each linked worktree's location in
 *   `<repo>/.git/worktrees/<id>/gitdir`, which still points at the old path.
 *   `git worktree repair` rewrites that pointer from the main worktree.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'

/** Directory name used by releases before the Sidings rename. */
export const LEGACY_STORE_DIR_NAME = '.spec-cat'
export const STORE_DIR_NAME = '.sidings'

export type StoreMigrationResult = {
  migrated: boolean
  /** Set when `migrated` is false, explaining why nothing moved. */
  reason?: 'no-legacy-store' | 'target-exists' | 'move-failed'
  error?: string
  sessionsRewritten: number
  worktreesRepaired: number
}

const SKIPPED = (reason: StoreMigrationResult['reason'], error?: string): StoreMigrationResult =>
  ({ migrated: false, reason, ...(error ? { error } : {}), sessionsRewritten: 0, worktreesRepaired: 0 })

/**
 * Moves `legacyDir` to `targetDir` and repairs the absolute paths the move
 * invalidated. Never merges: an existing `targetDir` means the migration
 * already ran (or the user set up the new location deliberately), so the
 * legacy directory is left untouched for them to reconcile by hand.
 */
export function migrateLegacyStoreDir(legacyDir: string, targetDir: string): StoreMigrationResult {
  if (!pathExists(legacyDir)) return SKIPPED('no-legacy-store')
  if (pathExists(targetDir)) return SKIPPED('target-exists')

  try {
    renameSync(legacyDir, targetDir)
  } catch (error) {
    return SKIPPED('move-failed', error instanceof Error ? error.message : String(error))
  }

  const worktreesByRepo = new Map<string, string[]>()
  let sessionsRewritten = 0

  for (const sessionFile of listSessionFiles(targetDir)) {
    const session = readJson(sessionFile)
    if (!session) continue

    const rewritten = rewritePaths(session, legacyDir, targetDir)
    if (rewritten !== session && writeJson(sessionFile, rewritten)) sessionsRewritten += 1

    const record = rewritten as { projectDir?: unknown, cwd?: unknown }
    const { projectDir, cwd } = record
    if (typeof projectDir !== 'string' || typeof cwd !== 'string') continue
    // Only worktrees that actually moved with the store need repairing.
    if (!isWithin(cwd, targetDir) || !existsSync(cwd) || !existsSync(projectDir)) continue
    const paths = worktreesByRepo.get(projectDir) || []
    if (!paths.includes(cwd)) paths.push(cwd)
    worktreesByRepo.set(projectDir, paths)
  }

  let worktreesRepaired = 0
  for (const [projectDir, paths] of worktreesByRepo) {
    try {
      execFileSync('git', ['-C', projectDir, 'worktree', 'repair', ...paths], { stdio: 'ignore' })
      worktreesRepaired += paths.length
    } catch {
      // Best effort: a repo that moved, vanished, or predates `worktree repair`
      // leaves its worktrees unlinked, which attach/restore reprovisions.
    }
  }

  return { migrated: true, sessionsRewritten, worktreesRepaired }
}

/**
 * Session records live at `<store>/<version>/projects/<projectKey>/sessions/*.json`.
 * Every level is read defensively so an unexpected layout (or an older version
 * directory alongside `v2`) degrades to "nothing to rewrite" instead of
 * aborting a move that already happened.
 */
function listSessionFiles(storeDir: string): string[] {
  const files: string[] = []
  for (const version of readDirNames(storeDir)) {
    const projects = join(storeDir, version, 'projects')
    for (const projectKey of readDirNames(projects)) {
      const sessions = join(projects, projectKey, 'sessions')
      for (const entry of readDirEntries(sessions)) {
        if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(sessions, entry.name))
      }
    }
  }
  return files
}

/**
 * Returns a copy with every string under `legacyDir` repointed at `targetDir`,
 * or the original value when nothing matched. Prefix-anchored, so paths outside
 * the store (the user's own `projectDir`) are left alone.
 */
function rewritePaths<T>(value: T, legacyDir: string, targetDir: string): T {
  if (typeof value === 'string') {
    if (value === legacyDir) return targetDir as unknown as T
    if (!value.startsWith(legacyDir + sep)) return value
    return (targetDir + value.slice(legacyDir.length)) as unknown as T
  }
  if (Array.isArray(value)) {
    const mapped = value.map((entry) => rewritePaths(entry, legacyDir, targetDir))
    return mapped.some((entry, index) => entry !== value[index]) ? mapped as unknown as T : value
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const mapped: Record<string, unknown> = {}
    let changed = false
    for (const [key, entry] of Object.entries(source)) {
      mapped[key] = rewritePaths(entry, legacyDir, targetDir)
      if (mapped[key] !== entry) changed = true
    }
    return changed ? mapped as unknown as T : value
  }
  return value
}

function isWithin(target: string, root: string) {
  return target === root || target.startsWith(root + sep)
}

function pathExists(path: string) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function readDirNames(path: string) {
  return readDirEntries(path).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

function readDirEntries(path: string) {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

function readJson(path: string): unknown {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Writes beside the target and atomically replaces it. Returns false on failure. */
function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' })
    renameSync(temporary, path)
    return true
  } catch {
    try { unlinkSync(temporary) } catch {}
    return false
  }
}
