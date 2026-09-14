import { afterEach, describe, expect, test } from 'bun:test'
import { useConversationTerminal } from '../composables/useConversationTerminal'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

describe('conversation terminal session state', () => {
  test('clears both the composable state and persisted session id', () => {
    const values = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage }
    })
    const terminal = useConversationTerminal({
      activeProvider: () => 'claude',
      onAttached: () => {},
      onGitChanged: () => {}
    })

    terminal.setSessionId('session-1')
    expect(terminal.sessionId.value).toBe('session-1')
    expect(localStorage.getItem('claude-web-session-id')).toBe('session-1')

    terminal.clearSessionId()
    expect(terminal.sessionId.value).toBe('')
    expect(localStorage.getItem('claude-web-session-id')).toBeNull()
    expect(terminal.getInitialSessionId('fallback')).toBe('fallback')
  })

  test('initializes with closed status and does not mutate sessionId on getInitialSessionId', () => {
    const values = new Map<string, string>([['claude-web-session-id', 'stored-session']])
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage }
    })
    const terminal = useConversationTerminal({
      activeProvider: () => 'claude',
      onAttached: () => {},
      onGitChanged: () => {}
    })

    expect(terminal.status.value).toBe('closed')
    expect(terminal.sessionId.value).toBe('')
    expect(terminal.getInitialSessionId()).toBe('stored-session')
    // Should NOT have mutated sessionId.value as a side-effect
    expect(terminal.sessionId.value).toBe('')
  })

  test('connect does not attempt connection when called with empty session and no creation options', () => {
    const values = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
    let webSocketCreated = false
    class MockWebSocket {
      constructor() { webSocketCreated = true }
      addEventListener() {}
      close() {}
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage,
        location: { protocol: 'http:', host: 'localhost:3000' },
        WebSocket: MockWebSocket
      }
    })
    const terminal = useConversationTerminal({
      activeProvider: () => 'claude',
      onAttached: () => {},
      onGitChanged: () => {}
    })

    terminal.connect(undefined)
    terminal.connect('')
    terminal.connect('   ')
    expect(terminal.status.value).toBe('closed')
    expect(webSocketCreated).toBe(false)
  })
})
