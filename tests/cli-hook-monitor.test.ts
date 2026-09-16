import { afterAll, describe, expect, test } from 'bun:test'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startCliHookMonitor, type CliHookMonitorOptions } from '../server/utils/cli-hook-monitor'
import type { CliHookRecord } from '../server/utils/cli-hooks'

const root = await mkdtemp(join(tmpdir(), 'sidings-hook-monitor-'))
let spoolCounter = 0

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function newSpoolPath() {
  spoolCounter += 1
  return join(root, `spool-${spoolCounter}.jsonl`)
}

function line(record: CliHookRecord) {
  return `${JSON.stringify(record)}\n`
}

type Observed = {
  prompts: CliHookRecord[]
  tools: Array<{ record: CliHookRecord; failed: boolean }>
  stops: CliHookRecord[]
}

function observe(options: Omit<CliHookMonitorOptions, 'pollMs' | 'onPromptSubmit' | 'onToolEvent' | 'onStop'>) {
  const observed: Observed = { prompts: [], tools: [], stops: [] }
  const monitor = startCliHookMonitor({
    ...options,
    pollMs: 10,
    onPromptSubmit: (record) => observed.prompts.push(record),
    onToolEvent: (record, failed) => observed.tools.push({ record, failed }),
    onStop: (record) => observed.stops.push(record)
  })
  return { monitor, observed }
}

describe('cli hook monitor', () => {
  test('emits prompt, tool, and stop callbacks for appended records', async () => {
    const spoolPath = newSpoolPath()
    const { monitor, observed } = observe({ spoolPath })

    await appendFile(spoolPath, line({ hookEventName: 'UserPromptSubmit', payload: { prompt: 'hi' } }))
    await appendFile(spoolPath, line({ hookEventName: 'PostToolUse', payload: { tool_name: 'Bash' } }))
    await appendFile(spoolPath, line({ hookEventName: 'PostToolUseFailure' }))
    await appendFile(spoolPath, line({ hookEventName: 'SubagentStop' }))
    await appendFile(spoolPath, line({ hookEventName: 'Stop', sessionId: 'prov-1' }))
    await wait(50)

    expect(observed.prompts).toHaveLength(1)
    expect(observed.tools.map((entry) => entry.failed)).toEqual([false, true, false])
    expect(observed.stops).toHaveLength(1)
    expect(observed.stops[0]?.sessionId).toBe('prov-1')
    expect(monitor.sawStop()).toBe(true)
    monitor.stop()
  })

  test('skips records that existed before the monitor started', async () => {
    const spoolPath = newSpoolPath()
    await writeFile(spoolPath, line({ hookEventName: 'Stop' }) + line({ hookEventName: 'UserPromptSubmit' }))

    const { monitor, observed } = observe({ spoolPath })
    await wait(40)
    expect(observed.prompts).toHaveLength(0)
    expect(observed.stops).toHaveLength(0)

    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(1)
    monitor.stop()
  })

  test('reassembles a multibyte record split across polls', async () => {
    const spoolPath = newSpoolPath()
    await writeFile(spoolPath, '')
    const { monitor, observed } = observe({ spoolPath })

    const record = line({ hookEventName: 'UserPromptSubmit', payload: { prompt: '한국어 프롬프트 검증 🐈' } })
    const bytes = Buffer.from(record, 'utf8')
    // Split inside the multibyte sequence of '한' so a naive string decode
    // would produce mojibake halves.
    const splitAt = record.indexOf('한') + 1
    await appendFile(spoolPath, bytes.subarray(0, splitAt))
    await wait(40)
    expect(observed.prompts).toHaveLength(0)

    await appendFile(spoolPath, bytes.subarray(splitAt))
    await wait(40)

    expect(observed.prompts).toHaveLength(1)
    expect((observed.prompts[0]?.payload as any)?.prompt).toBe('한국어 프롬프트 검증 🐈')
    monitor.stop()
  })

  test('recovers after the spool shrinks (rotation)', async () => {
    const spoolPath = newSpoolPath()
    await writeFile(spoolPath, line({ hookEventName: 'SessionStart' }).repeat(20))
    const { monitor, observed } = observe({ spoolPath })
    await wait(30)

    await writeFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)

    expect(observed.stops).toHaveLength(1)
    monitor.stop()
  })

  test('ignores stops while disarmed', async () => {
    const spoolPath = newSpoolPath()
    let armed = false
    const { monitor, observed } = observe({ spoolPath, isArmed: () => armed })

    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(0)
    expect(monitor.sawStop()).toBe(false)

    armed = true
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(1)
    monitor.stop()
  })

  test('requireArmedPromptSubmit gates each stop behind its own prompt', async () => {
    const spoolPath = newSpoolPath()
    const { monitor, observed } = observe({ spoolPath, requireArmedPromptSubmit: true })

    // A stray Stop before any witnessed prompt submit never completes a turn.
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(0)

    await appendFile(spoolPath, line({ hookEventName: 'UserPromptSubmit' }))
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(1)

    // The prompt was consumed: a second Stop without a fresh submit is stray.
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(1)

    // The next full turn fires again.
    await appendFile(spoolPath, line({ hookEventName: 'UserPromptSubmit' }))
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(2)
    monitor.stop()
  })

  test('a prompt submitted while disarmed does not open the stop gate', async () => {
    const spoolPath = newSpoolPath()
    let armed = false
    const { monitor, observed } = observe({
      spoolPath,
      isArmed: () => armed,
      requireArmedPromptSubmit: true
    })

    await appendFile(spoolPath, line({ hookEventName: 'UserPromptSubmit' }))
    await wait(40)
    armed = true
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)

    // The prompt callback still fired (activity tracking), but the Stop gate
    // never opened because the prompt was observed pre-arm.
    expect(observed.prompts).toHaveLength(1)
    expect(observed.stops).toHaveLength(0)
    monitor.stop()
  })

  test('self-disposes when shouldDispose reports the session gone', async () => {
    const spoolPath = newSpoolPath()
    let gone = false
    const { monitor, observed } = observe({ spoolPath, shouldDispose: () => gone })

    await appendFile(spoolPath, line({ hookEventName: 'UserPromptSubmit' }))
    await wait(40)
    expect(observed.prompts).toHaveLength(1)

    gone = true
    await wait(30)
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)
    expect(observed.stops).toHaveLength(0)
    monitor.stop()
  })

  test('ignores malformed lines without losing subsequent records', async () => {
    const spoolPath = newSpoolPath()
    const { monitor, observed } = observe({ spoolPath })

    await appendFile(spoolPath, 'not-json\n{"hookEventName":\n')
    await appendFile(spoolPath, line({ hookEventName: 'Stop' }))
    await wait(40)

    expect(observed.stops).toHaveLength(1)
    monitor.stop()
  })
})
