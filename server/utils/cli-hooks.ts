/**
 * CLI hook injection for deterministic turn detection.
 *
 * Screen scraping (turn-monitor.ts) infers turn completion from a ~1s quiet
 * window over tmux capture-pane output. CLI hooks replace that inference with
 * a deterministic signal: a tiny Node runner script is registered as a hook
 * command, receives the hook payload on stdin, and appends one JSON line per
 * event to a per-conversation spool file under STORE_ROOT/cli-hooks/. A
 * server-side tailer (cli-hook-monitor.ts) turns those lines into events.
 *
 * Per-provider capability:
 *
 * - claude: supports project-local hooks via `<cwd>/.claude/settings.local.json`.
 *   Every conversation runs in its own managed worktree, so writing that file
 *   into the session cwd never touches the user's global `~/.claude` config.
 *   The spool path is passed as an argv to the runner inside the hook command
 *   string, because the CLI runs inside a detached tmux session and does NOT
 *   inherit env vars from the node-pty process that attaches to it.
 *
 * - codex: the installed codex CLI only reads hooks from `<CODEX_HOME>/hooks.json`
 *   (plus `--dangerously-bypass-hook-trust`); there is no project-local hook
 *   file. code-cat does not manage a per-session CODEX_HOME — the user's real
 *   `~/.codex` holds auth and MUST NOT be modified — so codex stays on the
 *   existing screen-scrape detection. Both providers expose the same
 *   externally observable states (idle/working/waiting_input); claude just
 *   reaches them faster via hooks while codex keeps the quiet-window heuristic.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProviderId } from './session-store'
import { STORE_ROOT } from './session-store'

export type CliHookRecord = {
  timestamp?: string
  hookEventName?: string
  /** Provider-side session id (`session_id` from the hook payload). */
  sessionId?: string
  cwd?: string
  payload?: Record<string, unknown> | null
}

export type ClaudeHookInjection = {
  runnerPath: string
  spoolPath: string
  settingsPath: string
}

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SubagentStop'
] as const

const RUNNER_FILENAME = 'sidings-hook-runner.cjs'

// Markers identifying hook entries injected by this module (or by earlier
// versions that used the pre-rename runner name, or configured the spool
// through the environment), so re-running the injection replaces previous
// entries instead of accumulating duplicates. The legacy markers must stay:
// a worktree provisioned before the Sidings rename still carries a hook entry
// pointing at a runner path that no longer exists.
const INJECTED_ENTRY_MARKERS = [
  RUNNER_FILENAME,
  'SIDINGS_HOOK_SPOOL',
  'spec-cat-hook-runner.cjs',
  'SPEC_CAT_HOOK_SPOOL'
]

/** Only claude supports safe per-session hook injection (see module comment). */
export function providerSupportsCliHooks(provider: ProviderId) {
  return provider === 'claude'
}

export function getCliHookRunnerPath(storeRoot: string = STORE_ROOT) {
  return join(storeRoot, 'cli-hooks', RUNNER_FILENAME)
}

export function getCliHookSpoolPath(sessionId: string, storeRoot: string = STORE_ROOT) {
  return join(storeRoot, 'cli-hooks', `${sessionId}.jsonl`)
}

/**
 * Writes the hook runner script (idempotently) and returns its path. The
 * runner is plain Node with no dependencies: it reads the hook JSON payload
 * from stdin, appends one JSON line to the spool file given as argv[2], and
 * echoes `{}` on stdout for Stop/SubagentStop so the CLI proceeds normally.
 */
export function ensureCliHookRunner(storeRoot: string = STORE_ROOT): string {
  const runnerPath = getCliHookRunnerPath(storeRoot)
  mkdirSync(dirname(runnerPath), { recursive: true })

  const script = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  // Spool path comes from argv because the CLI runs inside a detached tmux
  // session and never sees the web server's environment.
  const spoolPath = process.argv[2] || process.env.SIDINGS_HOOK_SPOOL
  if (!spoolPath) process.exit(0)

  let payload = null
  try { payload = input.trim() ? JSON.parse(input) : null } catch { payload = { parseError: true, raw: input } }

  const record = {
    timestamp: new Date().toISOString(),
    hookEventName: payload && typeof payload === 'object' ? payload.hook_event_name : undefined,
    sessionId: payload && typeof payload === 'object' ? payload.session_id : undefined,
    cwd: payload && typeof payload === 'object' ? payload.cwd : undefined,
    payload
  }

  try {
    fs.mkdirSync(path.dirname(spoolPath), { recursive: true })
    fs.appendFileSync(spoolPath, JSON.stringify(record) + '\\n', 'utf8')
  } catch {}

  if (record.hookEventName === 'Stop' || record.hookEventName === 'SubagentStop') {
    process.stdout.write('{}')
  }
})
`

  try {
    const existing = existsSync(runnerPath) ? readFileSync(runnerPath, 'utf-8') : ''
    if (existing !== script) {
      writeFileSync(runnerPath, script, { encoding: 'utf-8', mode: 0o755 })
    }
  } catch {
    writeFileSync(runnerPath, script, { encoding: 'utf-8', mode: 0o755 })
  }

  return runnerPath
}

/** Parses one spool line. Returns null for blank, malformed, or non-object lines. */
export function parseCliHookRecord(line: string): CliHookRecord | null {
  const cleaned = line.trim()
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as CliHookRecord
  } catch {
    return null
  }
}

export function buildClaudeHooksJson(runnerPath: string, spoolPath: string): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {}
  for (const event of HOOK_EVENTS) {
    hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${runnerPath}" "${spoolPath}"`,
            timeout: 30
          }
        ]
      }
    ]
  }
  return { hooks }
}

/**
 * Ensures the hook runner exists and merges its hook entries into
 * `<cwd>/.claude/settings.local.json`. `cwd` is the session's managed
 * worktree, so this never pollutes the user's global claude config. Entries
 * injected by earlier runs are deduped; everything else in the file (other
 * settings keys, user-added hook entries) is preserved. Call this BEFORE
 * launching the CLI so hooks are active from the first turn.
 */
export function prepareClaudeHooks(
  cwd: string,
  sessionId: string,
  storeRoot: string = STORE_ROOT
): ClaudeHookInjection {
  const runnerPath = ensureCliHookRunner(storeRoot)
  const spoolPath = getCliHookSpoolPath(sessionId, storeRoot)
  const settingsPath = join(cwd, '.claude', 'settings.local.json')
  mkdirSync(dirname(settingsPath), { recursive: true })

  let existing: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      existing = {}
    }
  }

  const generated = buildClaudeHooksJson(runnerPath, spoolPath)
  writeFileSync(settingsPath, `${JSON.stringify(mergeHookConfig(existing, generated), null, 2)}\n`, 'utf-8')

  return { runnerPath, spoolPath, settingsPath }
}

function mergeHookConfig(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing }
  const existingHooks = existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
    ? existing.hooks as Record<string, unknown>
    : {}
  const generatedHooks = generated.hooks as Record<string, unknown[]>
  const hooks: Record<string, unknown> = { ...existingHooks }

  for (const [event, entries] of Object.entries(generatedHooks)) {
    const current = Array.isArray(existingHooks[event]) ? existingHooks[event] as unknown[] : []
    hooks[event] = [
      ...current.filter((entry) => {
        const serialized = JSON.stringify(entry)
        return !INJECTED_ENTRY_MARKERS.some((marker) => serialized.includes(marker))
      }),
      ...entries
    ]
  }

  merged.hooks = hooks
  return merged
}
