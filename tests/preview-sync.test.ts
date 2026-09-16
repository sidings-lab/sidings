import { afterAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const git = (cwd: string, args: string[]) => run('git', args, { cwd })

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => run('rm', ['-rf', root]).catch(() => {})))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'preview-sync-'))
  roots.push(root)
  const v2 = join(root, 'v2')
  await mkdir(v2, { recursive: true })
  const projectDir = join(root, 'proj')
  await mkdir(projectDir, { recursive: true })
  await git(projectDir, ['init', '-q'])
  await git(projectDir, ['config', 'user.email', 't@t.co'])
  await git(projectDir, ['config', 'user.name', 't'])
  await writeFile(join(projectDir, 'a.txt'), 'base\n')
  await git(projectDir, ['add', '-A'])
  await git(projectDir, ['commit', '-qm', 'c0'])
  const worktree = join(root, 'wt')
  await git(projectDir, ['worktree', 'add', '-q', '-b', 'sc/conv', worktree, 'HEAD'])

  process.env.SIDINGS_V2_DIR = v2
  process.env.SIDINGS_PROJECT_DIR = projectDir
  const store = await import('../server/utils/session-store')
  const integ = await import('../server/utils/session-integration')

  const id = 'conv-test'
  await store.writeStoredSession({
    id,
    provider: 'claude',
    tmuxName: 'x',
    cwd: worktree,
    cliBin: 'claude',
    projectDir,
    worktreeBranch: 'sc/conv',
    baseBranch: 'base',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any)
  await integ.previewSession(id)
  return { projectDir, worktree, integ }
}

async function commitInWorktree(worktree: string, content: string) {
  await writeFile(join(worktree, 'a.txt'), content)
  await git(worktree, ['add', '-A'])
  await git(worktree, ['commit', '-qm', `set-${content.trim()}`])
  return (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim()
}

describe('syncPreviewBranch', () => {
  test('follows a turn commit into both the branch ref and the working tree', async () => {
    const { projectDir, worktree, integ } = await setup()
    const head = await commitInWorktree(worktree, 'v1\n')
    await integ.syncPreviewBranch(projectDir, worktree, 'sc/preview')

    expect((await git(projectDir, ['rev-parse', 'sc/preview'])).stdout.trim()).toBe(head)
    expect(await readFile(join(projectDir, 'a.txt'), 'utf8')).toBe('v1\n')
  })

  test('concurrent syncs never fail and converge on the latest head', async () => {
    const { projectDir, worktree, integ } = await setup()
    const head = await commitInWorktree(worktree, 'v2\n')

    // The turn-end auto-commit and the HEAD watcher both sync the same commit.
    // Serialization must keep both from colliding on .git/index.lock.
    const results = await Promise.allSettled([
      integ.syncPreviewBranch(projectDir, worktree, 'sc/preview'),
      integ.syncPreviewBranch(projectDir, worktree, 'sc/preview'),
      integ.syncPreviewBranch(projectDir, worktree, 'sc/preview')
    ])
    for (const result of results) expect(result.status).toBe('fulfilled')

    expect((await git(projectDir, ['rev-parse', 'sc/preview'])).stdout.trim()).toBe(head)
    expect(await readFile(join(projectDir, 'a.txt'), 'utf8')).toBe('v2\n')
  })
})
