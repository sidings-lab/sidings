import { describe, expect, test } from 'bun:test'
import { describeWorktrees, isManagedWorktreeChild, parseWorktreeList } from '../server/utils/worktree'

const MANAGED_ROOT = '/home/user/.sidings/tmp'

const porcelainFixture = [
  'worktree /home/user/src/project',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${MANAGED_ROOT}/sc-abc12345`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/sc/abc12345',
  '',
  'worktree /home/user/src/detached-wt',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  '',
  `worktree ${MANAGED_ROOT}/feature-x`,
  'HEAD 4444444444444444444444444444444444444444',
  'branch refs/heads/feature/x',
  'locked reason with spaces',
  '',
  'worktree /home/user/src/old-wt',
  'HEAD 5555555555555555555555555555555555555555',
  'branch refs/heads/old',
  'prunable gitdir file points to non-existent location',
  ''
].join('\n')

describe('parseWorktreeList', () => {
  test('parses multiple worktrees with branch names stripped of refs/heads/', () => {
    const entries = parseWorktreeList(porcelainFixture)

    expect(entries).toHaveLength(5)
    expect(entries[0]).toEqual({
      path: '/home/user/src/project',
      head: '1111111111111111111111111111111111111111',
      branch: 'main',
      detached: false,
      locked: false,
      prunable: false,
      bare: false
    })
    expect(entries[1]?.branch).toBe('sc/abc12345')
    expect(entries[3]?.branch).toBe('feature/x')
  })

  test('marks detached worktrees with a null branch', () => {
    const entries = parseWorktreeList(porcelainFixture)
    const detached = entries[2]

    expect(detached?.detached).toBe(true)
    expect(detached?.branch).toBeNull()
    expect(detached?.head).toBe('3333333333333333333333333333333333333333')
  })

  test('parses locked worktrees with and without a reason', () => {
    const entries = parseWorktreeList(porcelainFixture)
    expect(entries[3]?.locked).toBe(true)

    const bareLock = parseWorktreeList([
      'worktree /tmp/wt',
      'HEAD 6666666666666666666666666666666666666666',
      'branch refs/heads/topic',
      'locked',
      ''
    ].join('\n'))
    expect(bareLock[0]?.locked).toBe(true)
  })

  test('parses prunable worktrees', () => {
    const entries = parseWorktreeList(porcelainFixture)
    expect(entries[4]?.prunable).toBe(true)
    expect(entries[4]?.locked).toBe(false)
  })

  test('parses a bare main worktree', () => {
    const entries = parseWorktreeList([
      'worktree /srv/repos/project.git',
      'bare',
      '',
      'worktree /srv/checkouts/main',
      'HEAD 7777777777777777777777777777777777777777',
      'branch refs/heads/main',
      ''
    ].join('\n'))

    expect(entries).toHaveLength(2)
    expect(entries[0]?.bare).toBe(true)
    expect(entries[0]?.branch).toBeNull()
    expect(entries[1]?.bare).toBe(false)
  })

  test('returns no entries for empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('\n\n')).toEqual([])
  })
})

describe('describeWorktrees', () => {
  test('marks the first entry as main and detects managed worktrees', () => {
    const described = describeWorktrees(parseWorktreeList(porcelainFixture), MANAGED_ROOT)

    expect(described.map((entry) => entry.isMain)).toEqual([true, false, false, false, false])
    // Managed via path + sc/ branch.
    expect(described[1]?.managed).toBe(true)
    // Managed via path under the managed root only.
    expect(described[3]?.managed).toBe(true)
    // Regular worktrees outside the managed root are unmanaged.
    expect(described[0]?.managed).toBe(false)
    expect(described[2]?.managed).toBe(false)
    expect(described[4]?.managed).toBe(false)
  })

  test('treats sc/ session branches as managed even outside the managed root', () => {
    const described = describeWorktrees(parseWorktreeList([
      'worktree /home/user/src/project',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /elsewhere/sc-copy',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/sc/abc12345',
      ''
    ].join('\n')), MANAGED_ROOT)

    expect(described[1]?.managed).toBe(true)
  })
})

describe('isManagedWorktreeChild', () => {
  test('accepts direct children of the managed root', () => {
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/sc-abc12345`, MANAGED_ROOT)).toBe(true)
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/feature-x`, MANAGED_ROOT)).toBe(true)
  })

  test('rejects the root itself, nested paths, and outside paths', () => {
    expect(isManagedWorktreeChild(MANAGED_ROOT, MANAGED_ROOT)).toBe(false)
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/a/b`, MANAGED_ROOT)).toBe(false)
    expect(isManagedWorktreeChild('/home/user/src/project', MANAGED_ROOT)).toBe(false)
    expect(isManagedWorktreeChild('/', MANAGED_ROOT)).toBe(false)
  })

  test('rejects traversal and sibling-prefix escapes', () => {
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/../escape`, MANAGED_ROOT)).toBe(false)
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/dir/../../escape`, MANAGED_ROOT)).toBe(false)
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}-evil/dir`, MANAGED_ROOT)).toBe(false)
    // Resolves back to a direct child, which stays allowed.
    expect(isManagedWorktreeChild(`${MANAGED_ROOT}/a/../b`, MANAGED_ROOT)).toBe(true)
  })
})
