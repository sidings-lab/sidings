import { describe, expect, test } from 'bun:test'
import { planRecovery, type RecoverySessionInfo } from '../server/utils/session-recovery'

const KEY = 'abc123abc123'
const OTHER_KEY = 'def456def456'

const activeSession: RecoverySessionInfo = {
  id: 'active-11111111',
  tmuxName: `claude-web-${KEY}-active-11111111`,
  cwd: '/home/user/.sidings/tmp/sc-active-11111111',
  projectDir: '/home/user/src/project',
  worktreeBranch: 'sc/active-11111111'
}

const archivedSession: RecoverySessionInfo = {
  id: 'archived-2222222',
  tmuxName: `codex-web-${KEY}-archived-2222222`,
  archived: true,
  cwd: '/home/user/.sidings/tmp/sc-archived-2222222',
  projectDir: '/home/user/src/project',
  worktreeBranch: 'sc/archived-2222222'
}

describe('planRecovery', () => {
  test('kills an orphaned managed tmux session with no stored session', () => {
    const plan = planRecovery([], [`claude-web-${KEY}-ghost-99999999`, `agy-web-${KEY}-ghost-88888888`], [], KEY)
    expect(plan.tmuxToKill).toEqual([`claude-web-${KEY}-ghost-99999999`, `agy-web-${KEY}-ghost-88888888`])
  })

  test('keeps the tmux session of a stored active session', () => {
    const plan = planRecovery([activeSession], [activeSession.tmuxName], [], KEY)
    expect(plan.tmuxToKill).toEqual([])
  })

  test('kills the tmux session of an archived session', () => {
    const plan = planRecovery([archivedSession], [archivedSession.tmuxName], [], KEY)
    expect(plan.tmuxToKill).toEqual([archivedSession.tmuxName])
  })

  test('ignores tmux sessions that do not match the managed naming pattern', () => {
    const plan = planRecovery(
      [],
      ['main', 'ssh-work', 'weekly-standup', 'web-claude-1', 'claudeweb-x'],
      [],
      KEY
    )
    expect(plan.tmuxToKill).toEqual([])
  })

  test('leaves another project\'s managed tmux sessions untouched', () => {
    const plan = planRecovery(
      [],
      [`claude-web-${OTHER_KEY}-ghost-99999999`, `codex-query-${OTHER_KEY}-abc123`, `agy-web-${OTHER_KEY}-ghost-77777777`],
      [],
      KEY
    )
    expect(plan.tmuxToKill).toEqual([])
  })

  test('kills orphaned one-shot query sessions unconditionally', () => {
    const plan = planRecovery(
      [activeSession],
      [activeSession.tmuxName, `claude-query-${KEY}-abc123`, `codex-query-${KEY}-def456`, `agy-query-${KEY}-ghi789`],
      [],
      KEY
    )
    expect(plan.tmuxToKill).toEqual([`claude-query-${KEY}-abc123`, `codex-query-${KEY}-def456`, `agy-query-${KEY}-ghi789`])
  })

  test('removes an orphaned worktree directory with no stored session', () => {
    const plan = planRecovery([], [], ['sc-ghost-99999999'], KEY)
    expect(plan.worktreesToRemove).toEqual([
      { dirName: 'sc-ghost-99999999', sessionId: 'ghost-99999999', projectDir: undefined }
    ])
  })

  test('keeps the worktree directory of a stored active session', () => {
    const plan = planRecovery([activeSession], [], [`sc-${activeSession.id}`], KEY)
    expect(plan.worktreesToRemove).toEqual([])
    expect(plan.missingWorktrees).toEqual([])
  })

  test('removes the worktree of an archived session, carrying its projectDir', () => {
    const plan = planRecovery([archivedSession], [], [`sc-${archivedSession.id}`], KEY)
    expect(plan.worktreesToRemove).toEqual([
      {
        dirName: `sc-${archivedSession.id}`,
        sessionId: archivedSession.id,
        projectDir: archivedSession.projectDir
      }
    ])
  })

  test('ignores directories that do not match the managed worktree pattern', () => {
    const plan = planRecovery([], [], ['random-dir', 'sc-short', 'worktree-x'], KEY)
    expect(plan.worktreesToRemove).toEqual([])
  })

  test('reports (without removing) active sessions whose worktree is missing', () => {
    const plan = planRecovery([activeSession], [], [], KEY)
    expect(plan.worktreesToRemove).toEqual([])
    expect(plan.missingWorktrees).toEqual([
      { sessionId: activeSession.id, worktreePath: activeSession.cwd }
    ])
  })

  test('does not report finalized or worktree-less sessions as missing worktrees', () => {
    const finalized: RecoverySessionInfo = { ...activeSession, finalized: true }
    const noWorktree: RecoverySessionInfo = {
      id: 'plain-333333333',
      tmuxName: `claude-web-${KEY}-plain-333333333`
    }
    const plan = planRecovery([finalized, noWorktree, archivedSession], [], [], KEY)
    expect(plan.missingWorktrees).toEqual([])
  })
})
