import { afterAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
  const root = await mkdtemp(join(tmpdir(), 'session-squash-'))
  roots.push(root)
  const v2 = join(root, 'v2')
  await mkdir(v2, { recursive: true })
  const projectDir = join(root, 'proj')
  await mkdir(projectDir, { recursive: true })
  await git(projectDir, ['init', '-q'])
  await git(projectDir, ['config', 'user.email', 't@t.co'])
  await git(projectDir, ['config', 'user.name', 't'])
  await writeFile(join(projectDir, 'base.txt'), 'base\n')
  await git(projectDir, ['add', '-A'])
  await git(projectDir, ['commit', '-qm', 'base'])
  await git(projectDir, ['branch', '-M', 'main'])

  const worktree = join(root, 'wt')
  await git(projectDir, ['worktree', 'add', '-q', '-b', 'sc/conv', worktree, 'HEAD'])

  await writeFile(join(projectDir, 'main.txt'), 'main moved\n')
  await git(projectDir, ['add', '-A'])
  await git(projectDir, ['commit', '-qm', 'main moved'])

  await writeFile(join(worktree, 'feature.txt'), 'one\n')
  await git(worktree, ['add', '-A'])
  await git(worktree, ['commit', '-qm', 'feature one'])
  await writeFile(join(worktree, 'feature.txt'), 'two\n')
  await git(worktree, ['add', '-A'])
  await git(worktree, ['commit', '-qm', 'feature two'])

  process.env.SIDINGS_V2_DIR = v2
  process.env.SIDINGS_PROJECT_DIR = projectDir
  const store = await import('../server/utils/session-store')
  const integ = await import('../server/utils/session-integration')

  const id = 'conv-squash-test'
  await store.writeStoredSession({
    id,
    provider: 'claude',
    tmuxName: 'x',
    cwd: worktree,
    cliBin: 'claude',
    projectDir,
    worktreeBranch: 'sc/conv',
    baseBranch: 'main',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any)

  return { id, projectDir, worktree, integ }
}

describe('squashSession', () => {
  test('rewrites the conversation branch to one commit on top of the base branch', async () => {
    const { id, worktree, integ } = await setup()

    const result = await integ.squashSession(id, 'main')

    expect(result.squashed).toBe(true)
    expect((await git(worktree, ['rev-list', '--count', 'main..HEAD'])).stdout.trim()).toBe('1')
    expect((await git(worktree, ['log', '-1', '--pretty=%s'])).stdout.trim()).toBe('chore: squash conversation commits')
    expect(await readFile(join(worktree, 'main.txt'), 'utf8')).toBe('main moved\n')
    expect(await readFile(join(worktree, 'feature.txt'), 'utf8')).toBe('two\n')
  })
})
