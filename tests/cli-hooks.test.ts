import { afterAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildClaudeHooksJson,
  ensureCliHookRunner,
  getCliHookSpoolPath,
  parseCliHookRecord,
  prepareClaudeHooks,
  providerSupportsCliHooks
} from '../server/utils/cli-hooks'

const root = await mkdtemp(join(tmpdir(), 'sidings-cli-hooks-'))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function readSettings(cwd: string) {
  const raw = await readFile(join(cwd, '.claude', 'settings.local.json'), 'utf8')
  return JSON.parse(raw) as Record<string, any>
}

describe('parseCliHookRecord', () => {
  test('parses a valid spool line', () => {
    const record = parseCliHookRecord('{"hookEventName":"Stop","sessionId":"abc","payload":{"stop_hook_active":false}}')
    expect(record?.hookEventName).toBe('Stop')
    expect(record?.sessionId).toBe('abc')
    expect(record?.payload).toEqual({ stop_hook_active: false })
  })

  test('returns null for blank and whitespace-only lines', () => {
    expect(parseCliHookRecord('')).toBeNull()
    expect(parseCliHookRecord('   ')).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    expect(parseCliHookRecord('{"hookEventName":')).toBeNull()
  })

  test('returns null for non-object JSON values', () => {
    expect(parseCliHookRecord('42')).toBeNull()
    expect(parseCliHookRecord('"Stop"')).toBeNull()
    expect(parseCliHookRecord('[{"hookEventName":"Stop"}]')).toBeNull()
  })
})

describe('provider capability', () => {
  test('only claude supports CLI hook injection', () => {
    expect(providerSupportsCliHooks('claude')).toBe(true)
    expect(providerSupportsCliHooks('codex')).toBe(false)
    expect(providerSupportsCliHooks('agy')).toBe(false)
  })
})

describe('buildClaudeHooksJson', () => {
  test('registers the runner with the spool path as an argument for every event', () => {
    const json = buildClaudeHooksJson('/store/cli-hooks/runner.cjs', '/store/cli-hooks/conv-1.jsonl') as any
    const events = Object.keys(json.hooks)
    expect(events).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'SubagentStop'
    ])
    for (const event of events) {
      const hook = json.hooks[event][0].hooks[0]
      expect(hook.type).toBe('command')
      expect(hook.command).toBe('node "/store/cli-hooks/runner.cjs" "/store/cli-hooks/conv-1.jsonl"')
    }
  })
})

describe('prepareClaudeHooks', () => {
  test('creates the runner and settings.local.json in the session worktree', async () => {
    const storeRoot = join(root, 'store-create')
    const cwd = join(root, 'worktree-create')
    const injection = prepareClaudeHooks(cwd, 'conv-create', storeRoot)

    expect(injection.spoolPath).toBe(getCliHookSpoolPath('conv-create', storeRoot))
    expect(existsSync(injection.runnerPath)).toBe(true)
    expect(statSync(injection.runnerPath).mode & 0o111).not.toBe(0)

    const settings = await readSettings(cwd)
    expect(settings.hooks.Stop[0].hooks[0].command)
      .toBe(`node "${injection.runnerPath}" "${injection.spoolPath}"`)
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
  })

  test('preserves unrelated settings keys and foreign hook entries', async () => {
    const storeRoot = join(root, 'store-merge')
    const cwd = join(root, 'worktree-merge')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(cwd, '.claude'), { recursive: true })
    await writeFile(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }]
      }
    }))

    prepareClaudeHooks(cwd, 'conv-merge', storeRoot)

    const settings = await readSettings(cwd)
    expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] })
    expect(settings.hooks.Stop).toHaveLength(2)
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('notify-send done')
    expect(settings.hooks.Stop[1].hooks[0].command).toContain('sidings-hook-runner.cjs')
  })

  test('re-running dedupes previously injected entries', async () => {
    const storeRoot = join(root, 'store-dedupe')
    const cwd = join(root, 'worktree-dedupe')

    prepareClaudeHooks(cwd, 'conv-dedupe', storeRoot)
    prepareClaudeHooks(cwd, 'conv-dedupe', storeRoot)
    prepareClaudeHooks(cwd, 'conv-dedupe', storeRoot)

    const settings = await readSettings(cwd)
    for (const entries of Object.values(settings.hooks) as any[]) {
      expect(entries).toHaveLength(1)
    }
  })

  test('replaces legacy env-configured entries', async () => {
    const storeRoot = join(root, 'store-legacy')
    const cwd = join(root, 'worktree-legacy')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(cwd, '.claude'), { recursive: true })
    await writeFile(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'SPEC_CAT_HOOK_SPOOL=/x node /y/runner.cjs' }] }]
      }
    }))

    prepareClaudeHooks(cwd, 'conv-legacy', storeRoot)

    const settings = await readSettings(cwd)
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('conv-legacy.jsonl')
  })

  test('replaces entries injected under the pre-rename runner name', async () => {
    const storeRoot = join(root, 'store-prerename')
    const cwd = join(root, 'worktree-prerename')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(cwd, '.claude'), { recursive: true })
    await writeFile(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'command',
            command: 'node "/home/u/.spec-cat/v2/cli-hooks/spec-cat-hook-runner.cjs" "/home/u/.spec-cat/v2/cli-hooks/conv.jsonl"'
          }]
        }]
      }
    }))

    prepareClaudeHooks(cwd, 'conv-prerename', storeRoot)

    const settings = await readSettings(cwd)
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('sidings-hook-runner.cjs')
    expect(settings.hooks.Stop[0].hooks[0].command).not.toContain('spec-cat')
  })
})

describe('hook runner script', () => {
  test('appends a spool record and echoes {} for Stop events', async () => {
    const storeRoot = join(root, 'store-runner')
    const runnerPath = ensureCliHookRunner(storeRoot)
    const spoolPath = getCliHookSpoolPath('conv-runner', storeRoot)

    const payload = { hook_event_name: 'Stop', session_id: 'prov-123', cwd: '/tmp/wt', stop_hook_active: false }
    const stdout = await runRunner(runnerPath, spoolPath, JSON.stringify(payload))
    expect(stdout).toBe('{}')

    const lines = (await readFile(spoolPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    const record = parseCliHookRecord(lines[0]!)
    expect(record?.hookEventName).toBe('Stop')
    expect(record?.sessionId).toBe('prov-123')
    expect(record?.cwd).toBe('/tmp/wt')
  })

  test('stays silent for non-stop events and preserves multibyte payloads', async () => {
    const storeRoot = join(root, 'store-runner-mb')
    const runnerPath = ensureCliHookRunner(storeRoot)
    const spoolPath = getCliHookSpoolPath('conv-runner-mb', storeRoot)

    const payload = { hook_event_name: 'UserPromptSubmit', prompt: '한국어 프롬프트 테스트' }
    const stdout = await runRunner(runnerPath, spoolPath, JSON.stringify(payload))
    expect(stdout).toBe('')

    const record = parseCliHookRecord(await readFile(spoolPath, 'utf8'))
    expect(record?.hookEventName).toBe('UserPromptSubmit')
    expect((record?.payload as any)?.prompt).toBe('한국어 프롬프트 테스트')
  })
})

function runRunner(runnerPath: string, spoolPath: string, stdin: string) {
  return new Promise<string>((resolve, reject) => {
    // process.execPath (bun) executes the plain-node .cjs script the same way
    // the claude CLI invokes it with node.
    const child = spawn(process.execPath, [runnerPath, spoolPath], { stdio: ['pipe', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.on('error', reject)
    child.on('close', () => resolve(stdout))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}
