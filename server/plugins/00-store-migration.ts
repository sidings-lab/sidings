import { homedir } from 'node:os'
import { join } from 'node:path'
import { LEGACY_STORE_DIR_NAME, STORE_DIR_NAME, migrateLegacyStoreDir } from '../utils/store-migration'

/**
 * Relocates a pre-rename `~/.spec-cat` state directory to `~/.sidings` on the
 * first run after upgrading.
 *
 * The filename sorts ahead of every other plugin deliberately: Nitro runs
 * plugins in filename order and does not await them, and boot recovery
 * (session-recovery.ts) must see the store at its final path. A recovery pass
 * that reads an empty store kills this project's live tmux sessions as
 * orphans, so the move is synchronous and completes inside this call.
 *
 * Skipped when SIDINGS_V2_DIR is set: an explicit store override means the
 * default `~/.sidings` location is not in play at all.
 */
export default defineNitroPlugin(() => {
  if (process.env.SIDINGS_V2_DIR) return

  const legacyDir = join(homedir(), LEGACY_STORE_DIR_NAME)
  const targetDir = join(homedir(), STORE_DIR_NAME)

  let result
  try {
    result = migrateLegacyStoreDir(legacyDir, targetDir)
  } catch (error) {
    // Startup must survive an unreadable or half-moved state directory.
    console.error('[store-migration] migration failed:', error)
    return
  }

  if (result.migrated) {
    console.log(
      `[store-migration] moved ${legacyDir} to ${targetDir}: `
        + `rewrote ${result.sessionsRewritten} session record(s), `
        + `repaired ${result.worktreesRepaired} worktree(s)`
    )
    return
  }

  if (result.reason === 'target-exists') {
    console.warn(
      `[store-migration] ${legacyDir} still exists but ${targetDir} is already in use; `
        + 'leaving the legacy directory untouched'
    )
  } else if (result.reason === 'move-failed') {
    console.error(`[store-migration] could not move ${legacyDir} to ${targetDir}: ${result.error}`)
  }
})
