import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testRoot = await mkdtemp(join(tmpdir(), 'spec-cat-prov-test-'))
process.env.SPEC_CAT_V2_DIR = testRoot
process.env.SPEC_CAT_PROJECT_DIR = testRoot

const { writeStoredSession } = await import('../server/utils/session-store')
const { provisionTerminalSession } = await import('../server/utils/terminal-provisioning')

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

describe('provisionTerminalSession guards', () => {
  test('rejects non-existent session when allowCreate is false', async () => {
    await expect(provisionTerminalSession({
      sessionId: 'conv-does-not-exist',
      provider: 'claude',
      allowCreate: false
    })).rejects.toThrow('Conversation conv-does-not-exist not found')
  })

  test('rejects archived session', async () => {
    const now = new Date().toISOString()
    await writeStoredSession({
      id: 'conv-archived-target',
      provider: 'claude',
      tmuxName: 'claude-web-archived',
      cwd: join(testRoot, 'tmp', 'sc-conv-archived-target'),
      cliBin: 'claude',
      projectDir: testRoot,
      createdAt: now,
      updatedAt: now,
      archived: true
    })

    await expect(provisionTerminalSession({
      sessionId: 'conv-archived-target',
      provider: 'claude',
      allowCreate: false
    })).rejects.toThrow('This conversation has been archived')
  })

  test('rejects finalized session', async () => {
    const now = new Date().toISOString()
    await writeStoredSession({
      id: 'conv-finalized-target',
      provider: 'claude',
      tmuxName: 'claude-web-finalized',
      cwd: join(testRoot, 'tmp', 'sc-conv-finalized-target'),
      cliBin: 'claude',
      projectDir: testRoot,
      createdAt: now,
      updatedAt: now,
      finalized: true
    })

    await expect(provisionTerminalSession({
      sessionId: 'conv-finalized-target',
      provider: 'claude',
      allowCreate: false
    })).rejects.toThrow('This conversation has been finalized')
  })
})
