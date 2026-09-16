import { afterAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { migrateLegacyStoreDir } from '../server/utils/store-migration'

const run = promisify(execFile)
const git = (cwd: string, args: string[]) => run('git', args, { cwd })

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => run('rm', ['-rf', root]).catch(() => {})))
})

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'sidings-store-migration-'))
  roots.push(root)
  return root
}

/** Writes a session record into the legacy store's per-project sessions dir. */
async function writeSession(storeDir: string, id: string, session: Record<string, unknown>) {
  const sessions = join(storeDir, 'v2', 'projects', 'abc123def456', 'sessions')
  await mkdir(sessions, { recursive: true })
  await writeFile(join(sessions, `${id}.json`), `${JSON.stringify(session, null, 2)}\n`)
  return join(sessions, `${id}.json`)
}

function readSession(storeDir: string, id: string) {
  const path = join(storeDir, 'v2', 'projects', 'abc123def456', 'sessions', `${id}.json`)
  return readFile(path, 'utf-8').then((raw) => JSON.parse(raw) as Record<string, unknown>)
}

describe('migrateLegacyStoreDir', () => {
  test('does nothing when there is no legacy store', async () => {
    const root = await makeRoot()
    const result = migrateLegacyStoreDir(join(root, '.spec-cat'), join(root, '.sidings'))

    expect(result.migrated).toBe(false)
    expect(result.reason).toBe('no-legacy-store')
    expect(existsSync(join(root, '.sidings'))).toBe(false)
  })

  test('leaves the legacy store untouched when the target already exists', async () => {
    const root = await makeRoot()
    const legacy = join(root, '.spec-cat')
    const target = join(root, '.sidings')
    await writeSession(legacy, 'old', { id: 'old', cwd: join(legacy, 'v2', 'tmp', 'sc-old') })
    await writeSession(target, 'new', { id: 'new' })

    const result = migrateLegacyStoreDir(legacy, target)

    expect(result.migrated).toBe(false)
    expect(result.reason).toBe('target-exists')
    expect(existsSync(join(legacy, 'v2'))).toBe(true)
    await expect(readSession(target, 'new')).resolves.toMatchObject({ id: 'new' })
  })

  test('moves the directory and repoints stored paths at the new root', async () => {
    const root = await makeRoot()
    const legacy = join(root, '.spec-cat')
    const target = join(root, '.sidings')
    const projectDir = join(root, 'proj')
    await mkdir(projectDir, { recursive: true })
    await writeSession(legacy, 'sess1', {
      id: 'sess1',
      projectDir,
      cwd: join(legacy, 'v2', 'projects', 'abc123def456', 'tmp', 'sc-sess1'),
      tmuxName: 'claude-web-abc123def456-sess1'
    })

    const result = migrateLegacyStoreDir(legacy, target)

    expect(result.migrated).toBe(true)
    expect(result.sessionsRewritten).toBe(1)
    expect(existsSync(legacy)).toBe(false)

    const session = await readSession(target, 'sess1')
    expect(session.cwd).toBe(join(target, 'v2', 'projects', 'abc123def456', 'tmp', 'sc-sess1'))
    // Paths outside the store keep pointing where they did.
    expect(session.projectDir).toBe(projectDir)
    expect(session.tmuxName).toBe('claude-web-abc123def456-sess1')
  })

  test('leaves records without legacy paths byte-identical', async () => {
    const root = await makeRoot()
    const legacy = join(root, '.spec-cat')
    const path = await writeSession(legacy, 'sess1', { id: 'sess1', projectDir: join(root, 'proj') })
    const before = await readFile(path, 'utf-8')

    const result = migrateLegacyStoreDir(legacy, join(root, '.sidings'))

    expect(result.migrated).toBe(true)
    expect(result.sessionsRewritten).toBe(0)
    const after = await readFile(join(root, '.sidings', 'v2', 'projects', 'abc123def456', 'sessions', 'sess1.json'), 'utf-8')
    expect(after).toBe(before)
  })

  test('repairs git worktrees that moved with the store', async () => {
    const root = await makeRoot()
    const legacy = join(root, '.spec-cat')
    const target = join(root, '.sidings')

    const projectDir = join(root, 'proj')
    await mkdir(projectDir, { recursive: true })
    await git(projectDir, ['init', '-q'])
    await git(projectDir, ['config', 'user.email', 't@t.co'])
    await git(projectDir, ['config', 'user.name', 't'])
    await writeFile(join(projectDir, 'base.txt'), 'base\n')
    await git(projectDir, ['add', '-A'])
    await git(projectDir, ['commit', '-qm', 'base'])

    const worktreeRoot = join(legacy, 'v2', 'projects', 'abc123def456', 'tmp')
    await mkdir(worktreeRoot, { recursive: true })
    const legacyWorktree = join(worktreeRoot, 'sc-sess1')
    await git(projectDir, ['worktree', 'add', '-q', '-b', 'sc/sess1', legacyWorktree, 'HEAD'])
    await writeSession(legacy, 'sess1', {
      id: 'sess1',
      projectDir,
      cwd: legacyWorktree,
      worktreeBranch: 'sc/sess1'
    })

    const result = migrateLegacyStoreDir(legacy, target)

    expect(result.migrated).toBe(true)
    expect(result.worktreesRepaired).toBe(1)

    const movedWorktree = join(target, 'v2', 'projects', 'abc123def456', 'tmp', 'sc-sess1')
    const { stdout } = await git(projectDir, ['worktree', 'list', '--porcelain'])
    expect(stdout).toContain(`worktree ${movedWorktree}`)
    expect(stdout).not.toContain(legacyWorktree)

    // The moved worktree is a working git checkout, not a dangling directory.
    const { stdout: branch } = await git(movedWorktree, ['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(branch.trim()).toBe('sc/sess1')
  })
})
