import { describe, expect, test } from 'bun:test'
import type { SessionListItem } from '../types/session'
import { resolveInitialSessionAction } from '../utils/session-resolution'

function makeItem(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  const now = new Date().toISOString()
  return {
    id,
    provider: 'claude',
    tmuxName: `claude-web-${id}`,
    cwd: `/tmp/${id}`,
    projectDir: '/test/project',
    cliBin: 'claude',
    createdAt: now,
    updatedAt: now,
    logBytes: 100,
    ...overrides
  }
}

describe('resolveInitialSessionAction', () => {
  const active1 = makeItem('conv-1')
  const active2 = makeItem('conv-2')
  const finalized = makeItem('conv-3', { finalized: true })
  const archived = makeItem('conv-4', { archived: true })

  test('connects to matching active session when stored in localStorage', () => {
    const res = resolveInitialSessionAction('conv-2', [active1, active2], [archived])
    expect(res).toEqual({ action: 'connect', sessionId: 'conv-2' })
  })

  test('selects matching finalized session without terminal connect', () => {
    const res = resolveInitialSessionAction('conv-3', [active1, finalized], [archived])
    expect(res).toEqual({ action: 'select', sessionId: 'conv-3' })
  })

  test('selects matching archived session in read-only mode without terminal connect', () => {
    const res = resolveInitialSessionAction('conv-4', [active1], [archived])
    expect(res).toEqual({ action: 'selectArchived', session: archived })
  })

  test('falls back to first active session when stored ID is from another project or deleted', () => {
    const res = resolveInitialSessionAction('conv-foreign', [active1, active2], [archived])
    expect(res).toEqual({ action: 'connect', sessionId: 'conv-1' })
  })

  test('falls back to first active session when stored ID is empty or undefined', () => {
    const resNull = resolveInitialSessionAction(null, [active1, active2], [])
    expect(resNull).toEqual({ action: 'connect', sessionId: 'conv-1' })

    const resEmpty = resolveInitialSessionAction('', [active1, active2], [])
    expect(resEmpty).toEqual({ action: 'connect', sessionId: 'conv-1' })

    const resWhitespace = resolveInitialSessionAction('   ', [active1, active2], [])
    expect(resWhitespace).toEqual({ action: 'connect', sessionId: 'conv-1' })
  })

  test('returns idle when active sessions list is empty and stored ID is not archived', () => {
    const resForeign = resolveInitialSessionAction('conv-stale', [], [archived])
    expect(resForeign).toEqual({ action: 'idle' })

    const resNone = resolveInitialSessionAction(null, [], [])
    expect(resNone).toEqual({ action: 'idle' })
  })

  test('selects archived session even when active sessions list is empty if stored was archived', () => {
    const res = resolveInitialSessionAction('conv-4', [], [archived])
    expect(res).toEqual({ action: 'selectArchived', session: archived })
  })
})
