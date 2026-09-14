import type { Terminal } from '@xterm/xterm'
import type { ProviderId } from '~/types/session'
import { ref } from 'vue'
import { createTerminalFitScheduler } from '~/utils/terminal-fit'

type TerminalTheme = NonNullable<Terminal['options']['theme']>
type ConnectRequest = {
  targetSessionId?: string
  provider?: ProviderId
  creation?: { baseBranch?: string; featureId?: string }
}

export function useConversationTerminal(options: {
  activeProvider: () => ProviderId | undefined
  onAttached: (sessionId: string) => void
  onGitChanged: () => void
}) {
  const terminalEl = ref<HTMLElement | null>(null)
  const sessionId = ref('')
  const status = ref<'connecting' | 'connected' | 'closed'>('closed')
  let terminal: Terminal | null = null
  let fitAddon: import('@xterm/addon-fit').FitAddon | null = null
  let socket: WebSocket | null = null
  let resizeObserver: ResizeObserver | null = null
  let removeClipboardBridge: (() => void) | null = null
  let lastSentSize = { cols: 0, rows: 0 }
  let observedSize = { width: 0, height: 0 }
  let pendingConnect: ConnectRequest | null = null
  let disposed = false
  const fitScheduler = createTerminalFitScheduler(() => performFit())

  async function initialize(config: {
    fontSize: number
    theme: TerminalTheme
    attachClipboardBridge: (terminal: Terminal, mount: HTMLElement) => () => void
  }) {
    if (!terminalEl.value) return
    const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebglAddon }] = await Promise.all([
      import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-unicode11'), import('@xterm/addon-webgl')
    ])
    if (disposed || !terminalEl.value) return
    terminal = new Terminal({
      allowProposedApi: true, cursorBlink: true, convertEol: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: config.fontSize, lineHeight: 1.25, theme: config.theme
    })
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    const unicode11 = new Unicode11Addon()
    terminal.loadAddon(unicode11)
    terminal.unicode.activeVersion = '11'
    terminal.open(terminalEl.value)
    removeClipboardBridge = config.attachClipboardBridge(terminal, terminalEl.value)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      terminal.loadAddon(webgl)
    } catch {}
    terminal.onData((data) => {
      if (isConnected()) socket!.send(JSON.stringify({ type: 'input', data }))
    })
    resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width === observedSize.width && height === observedSize.height) return
      observedSize = { width, height }
      scheduleFit()
    })
    resizeObserver.observe(terminalEl.value)
    const request = pendingConnect
    pendingConnect = null
    if (request) connect(request.targetSessionId, request.provider, request.creation)
  }

  function connect(targetSessionId?: string, provider?: ProviderId, creation?: { baseBranch?: string; featureId?: string }) {
    if ((!targetSessionId || !targetSessionId.trim()) && !creation) return
    if (!terminal) {
      pendingConnect = { targetSessionId, provider, creation }
      status.value = 'connecting'
      return
    }
    lastSentSize = { cols: 0, rows: 0 }
    socket?.close()
    status.value = 'connecting'
    terminal.reset()
    terminal.writeln(`Connecting to ${provider || options.activeProvider() || 'claude'} CLI...\r\n`)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(`${protocol}//${window.location.host}/api/terminal`)
    socket = current
    current.addEventListener('open', () => {
      if (socket !== current) return
      status.value = 'connected'
      performFit(false)
      current.send(JSON.stringify({
        type: 'attach',
        sessionId: targetSessionId,
        create: Boolean(creation),
        provider,
        baseBranch: creation?.baseBranch,
        featureId: creation?.featureId,
        cols: terminal?.cols,
        rows: terminal?.rows
      }))
      terminal?.focus()
    })
    current.addEventListener('message', (event) => {
      if (socket !== current) return
      const data = String(event.data)
      const control = parseControlMessage(data)
      if (control?.type === 'attached') {
        setSessionId(control.sessionId)
        settleFit()
        options.onAttached(control.sessionId)
      } else if (control?.type === 'git-changed') options.onGitChanged()
      else if (!control) terminal?.write(data)
    })
    current.addEventListener('close', () => {
      if (socket !== current) return
      status.value = 'closed'
      terminal?.writeln('\r\n\r\n[connection closed]')
    })
    current.addEventListener('error', () => {
      if (socket === current) terminal?.writeln('\r\n\r\n[websocket error]')
    })
  }

  function sendCommand(command: string) {
    if (!isConnected()) return false
    // Automated prompts need a real, separate Enter key in Codex. Sending the
    // text and CR in one PTY write is interpreted as a modified Enter there.
    socket!.send(JSON.stringify({ type: 'submit', data: command }))
    return true
  }
  function sendText(value: string) {
    if (!isConnected()) return false
    socket!.send(JSON.stringify({ type: 'submit', data: value }))
    return true
  }
  function isConnected() { return socket?.readyState === WebSocket.OPEN }
  function close() { socket?.close(); socket = null; status.value = 'closed' }
  function reset(cursorBlink = true) { terminal?.reset(); if (terminal) terminal.options.cursorBlink = cursorBlink }
  function setCursorBlink(value: boolean) { if (terminal) terminal.options.cursorBlink = value }
  function write(value: string, scrollToBottom = false) { terminal?.write(value, scrollToBottom ? () => terminal?.scrollToBottom() : undefined) }
  function writeln(value: string) { terminal?.writeln(value) }
  function setSessionId(value: string) {
    sessionId.value = value
    window.localStorage.setItem('claude-web-session-id', value)
  }
  function clearSessionId() {
    sessionId.value = ''
    window.localStorage.removeItem('claude-web-session-id')
  }
  function getInitialSessionId(fallback?: string) {
    if (sessionId.value) return sessionId.value
    const stored = window.localStorage.getItem('claude-web-session-id')
    return stored || fallback
  }
  function updateAppearance(fontSize: number, theme: TerminalTheme) {
    if (!terminal) return
    terminal.options.fontSize = fontSize
    terminal.options.theme = theme
    performFit()
    terminal.refresh(0, terminal.rows - 1)
  }
  function sendResize() {
    if (!terminal || !isConnected()) return false
    if (terminal.buffer.active.viewportY === terminal.buffer.active.baseY) terminal.write('\x1b[3J', () => terminal?.scrollToBottom())
    socket!.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    return true
  }
  function performFit(notifyServer = true) {
    const mount = terminalEl.value
    if (!terminal || !fitAddon || !mount || mount.clientWidth < 1 || mount.clientHeight < 1) return
    const dimensions = fitAddon.proposeDimensions()
    if (!dimensions || dimensions.cols < 1 || dimensions.rows < 1) return
    if (dimensions.cols !== terminal.cols || dimensions.rows !== terminal.rows) fitAddon.fit()
    if (terminal.cols < 1 || terminal.rows < 1 || (terminal.cols === lastSentSize.cols && terminal.rows === lastSentSize.rows)) return
    if (notifyServer && sendResize()) lastSentSize = { cols: terminal.cols, rows: terminal.rows }
  }
  function scheduleFit(delay = 0) {
    fitScheduler.schedule(delay)
  }
  function settleFit() {
    fitScheduler.settle()
  }
  function dispose() {
    disposed = true
    pendingConnect = null
    resizeObserver?.disconnect()
    removeClipboardBridge?.()
    fitScheduler.dispose()
    socket?.close()
    terminal?.dispose()
  }
  function parseControlMessage(data: string): { type: 'hello' } | { type: 'git-changed' } | { type: 'attached'; sessionId: string } | null {
    if (!data.startsWith('\x00')) return null
    try {
      const value = JSON.parse(data.slice(1)) as Record<string, unknown>
      if (value.type === 'hello') return { type: 'hello' }
      if (value.type === 'git-changed') return { type: 'git-changed' }
      if (value.type === 'attached' && typeof value.sessionId === 'string') return { type: 'attached', sessionId: value.sessionId }
    } catch {}
    return null
  }

  return { terminalEl, sessionId, status, initialize, connect, sendCommand, sendText, isConnected,
    close, reset, setCursorBlink, write, writeln, setSessionId, clearSessionId, getInitialSessionId, updateAppearance,
    scheduleFit, settleFit, dispose }
}
