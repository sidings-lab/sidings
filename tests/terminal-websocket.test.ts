import { describe, expect, test } from 'bun:test'
import type { Peer } from 'crossws'
import type { TerminalSession } from '../server/utils/terminal-session'
import { createTerminalWebSocketHandlers } from '../server/utils/terminal-websocket'

function peerHarness() {
  const sent: string[] = []
  let closed = false
  const peer = {
    context: {} as Record<string, unknown>,
    send: (value: string) => { sent.push(value) },
    close: () => { closed = true }
  } as unknown as Peer
  return { peer, sent, isClosed: () => closed }
}

function sessionHarness(peer: Peer) {
  const writes: string[] = []
  const resizes: Array<[number, number]> = []
  let submitted = 0
  const pty = {
    cols: 80,
    rows: 24,
    write: (value: string) => { writes.push(value) },
    resize: (cols: number, rows: number) => { resizes.push([cols, rows]) }
  }
  const session = {
    id: 'conv-test',
    provider: 'claude',
    tmuxName: 'claude-web-test',
    cwd: '/tmp/test',
    cliBin: 'claude --dangerously-skip-permissions',
    peers: new Map([[peer, pty]]),
    loggerPeer: peer,
    cols: 80,
    rows: 24,
    cleanupTimer: null,
    turnMonitor: { submitted: () => { submitted++ } },
    hookMonitor: null,
    gitWatcher: null,
    idleCommitTimer: null
  } as unknown as TerminalSession
  return { session, writes, resizes, submitted: () => submitted }
}

describe('terminal WebSocket dispatch', () => {
  test('keeps hello and unattached error frames unchanged', async () => {
    const harness = peerHarness()
    const handlers = createTerminalWebSocketHandlers({
      attach: async () => { throw new Error('unused') },
      sessionForPeer: () => null,
      detach: () => {}
    })

    handlers.open(harness.peer)
    await handlers.message(harness.peer, { text: () => 'raw input' })

    expect(harness.sent[0]).toBe('\0{"type":"hello"}')
    expect(harness.sent[1]).toBe('\r\n[terminal session is not attached]\r\n')
  })

  test('routes raw input and resize without rewriting data', async () => {
    const harness = peerHarness()
    const terminal = sessionHarness(harness.peer)
    const handlers = createTerminalWebSocketHandlers({
      attach: async () => terminal.session,
      sessionForPeer: () => terminal.session,
      detach: () => {}
    })

    await handlers.message(harness.peer, { text: () => 'α\r' })
    await handlers.message(harness.peer, { text: () => JSON.stringify({ type: 'resize', cols: 120, rows: 40 }) })

    expect(terminal.writes).toEqual(['α\r'])
    expect(terminal.submitted()).toBe(1)
    expect(terminal.resizes).toEqual([[120, 40]])
    expect([terminal.session.cols, terminal.session.rows]).toEqual([120, 40])
  })

  test('keeps attach success and failure frames unchanged', async () => {
    const success = peerHarness()
    const terminal = sessionHarness(success.peer)
    const handlers = createTerminalWebSocketHandlers({
      attach: async () => terminal.session,
      sessionForPeer: () => null,
      detach: () => {}
    })
    await handlers.message(success.peer, { text: () => JSON.stringify({ type: 'attach', sessionId: 'conv-test' }) })
    expect(success.sent).toEqual(['\0{"type":"attached","sessionId":"conv-test"}'])

    const failure = peerHarness()
    const failing = createTerminalWebSocketHandlers({
      attach: async () => { throw new Error('boom') },
      sessionForPeer: () => null,
      detach: () => {}
    })
    await failing.message(failure.peer, { text: () => JSON.stringify({ type: 'attach' }) })
    expect(failure.sent).toEqual(['\r\n[failed to attach tmux session: boom]\r\n'])
    expect(failure.isClosed()).toBe(true)
  })

  test('forwards create flag to attach handler', async () => {
    let receivedCreate: boolean | undefined
    let receivedSessionId: string | undefined
    const harness = peerHarness()
    const terminal = sessionHarness(harness.peer)
    const handlers = createTerminalWebSocketHandlers({
      attach: async (_peer, sessionId, _provider, _baseBranch, _featureId, _cols, _rows, create) => {
        receivedSessionId = sessionId
        receivedCreate = create
        return terminal.session
      },
      sessionForPeer: () => null,
      detach: () => {}
    })

    await handlers.message(harness.peer, { text: () => JSON.stringify({ type: 'attach', create: true }) })
    expect(receivedCreate).toBe(true)
    expect(receivedSessionId).toBeUndefined()

    await handlers.message(harness.peer, { text: () => JSON.stringify({ type: 'attach', sessionId: 'conv-1' }) })
    expect(receivedCreate).toBe(false)
    expect(receivedSessionId).toBe('conv-1')
  })
})
