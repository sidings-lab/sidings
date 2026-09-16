import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StoredTerminalSession } from '../server/utils/session-store'

// The store resolves its root from the environment at import time, so the
// override must be in place before the module is loaded.
const storeRoot = await mkdtemp(join(tmpdir(), 'sidings-store-'))
process.env.SIDINGS_V2_DIR = storeRoot
// Session listings are scoped to the launching project, so pin it to the
// store root the fixture sessions belong to.
process.env.SIDINGS_PROJECT_DIR = storeRoot

const {
  appendSessionLog,
  deleteStoredSession,
  listArchivedSessions,
  listStoredSessions,
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle,
  readStoredSession,
  readSessionLog,
  writeStoredSession
} = await import('../server/utils/session-store')

afterAll(async () => {
  await rm(storeRoot, { recursive: true, force: true })
})

function makeSession(id: string, overrides: Partial<StoredTerminalSession> = {}): StoredTerminalSession {
  const now = new Date().toISOString()
  return {
    id,
    provider: 'claude',
    tmuxName: `claude-web-${id}`,
    cwd: join(storeRoot, 'worktrees', id),
    projectDir: storeRoot,
    cliBin: 'claude',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('Session title validation', () => {
  test('trims and returns a valid title', () => {
    expect(normalizeSessionTitle('  Fix login flow  ')).toBe('Fix login flow')
  })

  test('empty and whitespace-only titles clear the title', () => {
    expect(normalizeSessionTitle('')).toBeUndefined()
    expect(normalizeSessionTitle('   ')).toBeUndefined()
  })

  test('accepts a title at the maximum length', () => {
    const title = 'a'.repeat(MAX_SESSION_TITLE_LENGTH)
    expect(normalizeSessionTitle(title)).toBe(title)
  })

  test('rejects a title over the maximum length', () => {
    expect(() => normalizeSessionTitle('a'.repeat(MAX_SESSION_TITLE_LENGTH + 1))).toThrow()
  })

  test.each([[42], [null], [undefined], [{ title: 'x' }], [['x']]])('rejects non-string titles: %p', (value) => {
    expect(() => normalizeSessionTitle(value)).toThrow()
  })
})

describe('Session title round-trip', () => {
  test('persists and clears a title', async () => {
    await writeStoredSession(makeSession('conv-title-1', { title: 'My conversation' }))

    const stored = await readStoredSession('conv-title-1')
    expect(stored?.title).toBe('My conversation')

    await writeStoredSession({ ...stored!, title: undefined })
    const cleared = await readStoredSession('conv-title-1')
    expect(cleared?.title).toBeUndefined()
  })
})

describe('Archive flag round-trip', () => {
  test('active sessions are listed and not archived', async () => {
    await writeStoredSession(makeSession('conv-active-1'))

    const active = await listStoredSessions()
    expect(active.some((session) => session.id === 'conv-active-1')).toBe(true)

    const archived = await listArchivedSessions()
    expect(archived.some((session) => session.id === 'conv-active-1')).toBe(false)
  })

  test('archived sessions move to the archive list with their metadata', async () => {
    const archivedAt = new Date().toISOString()
    await writeStoredSession(makeSession('conv-archived-1', {
      archived: true,
      archivedAt,
      branchKept: true,
      worktreeBranch: 'sc/conv-archived-1'
    }))

    const active = await listStoredSessions()
    expect(active.some((session) => session.id === 'conv-archived-1')).toBe(false)

    const archives = await listArchivedSessions()
    const entry = archives.find((session) => session.id === 'conv-archived-1')
    expect(entry).toBeDefined()
    expect(entry?.archived).toBe(true)
    expect(entry?.archivedAt).toBe(archivedAt)
    expect(entry?.branchKept).toBe(true)

    const stored = await readStoredSession('conv-archived-1')
    expect(stored?.archived).toBe(true)
    expect(stored?.archivedAt).toBe(archivedAt)
  })

  test('archived terminal history remains available for read-only browsing', async () => {
    const id = `conv-archive-log-${randomUUID()}`
    await writeStoredSession(makeSession(id, {
      archived: true,
      archivedAt: new Date().toISOString()
    }))
    await appendSessionLog(id, 'first turn\r\n')
    await appendSessionLog(id, 'second turn\r\n')

    expect(await readSessionLog(id)).toBe('first turn\r\nsecond turn\r\n')
  })

  test('restoring clears the archive flags', async () => {
    await writeStoredSession(makeSession('conv-restore-1', {
      archived: true,
      archivedAt: new Date().toISOString(),
      branchKept: true
    }))

    const stored = await readStoredSession('conv-restore-1')
    await writeStoredSession({
      ...stored!,
      archived: undefined,
      archivedAt: undefined,
      branchKept: undefined,
      updatedAt: new Date().toISOString()
    })

    const restored = await readStoredSession('conv-restore-1')
    expect(restored?.archived).toBeUndefined()
    expect(restored?.archivedAt).toBeUndefined()

    const active = await listStoredSessions()
    expect(active.some((session) => session.id === 'conv-restore-1')).toBe(true)

    const archives = await listArchivedSessions()
    expect(archives.some((session) => session.id === 'conv-restore-1')).toBe(false)
  })

  test('deleting an archived session removes it from the store', async () => {
    await writeStoredSession(makeSession('conv-delete-1', {
      archived: true,
      archivedAt: new Date().toISOString()
    }))

    await deleteStoredSession('conv-delete-1')

    expect(await readStoredSession('conv-delete-1')).toBeNull()
    const archives = await listArchivedSessions()
    expect(archives.some((session) => session.id === 'conv-delete-1')).toBe(false)
  })
})
