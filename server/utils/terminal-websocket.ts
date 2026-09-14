import type { Peer } from 'crossws'
import type { ProviderId } from './session-store'
import type { TerminalSession } from './terminal-session'
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  clampTerminalDimension,
  encodeTerminalControl,
  parseTerminalMessage
} from './terminal-protocol'
import { recordTerminalInput } from './runtime-activity'
import { submitPromptTurn } from './tmux-input'

type AttachTerminalSession = (
  peer: Peer,
  sessionId?: string,
  provider?: ProviderId,
  baseBranch?: string,
  featureId?: string,
  cols?: number,
  rows?: number,
  create?: boolean
) => Promise<TerminalSession>

export function createTerminalWebSocketHandlers(options: {
  attach: AttachTerminalSession
  sessionForPeer: (peer: Peer) => TerminalSession | null
  detach: (peer: Peer) => void
}) {
  return {
    open(peer: Peer) {
      sendTerminalControl(peer, { type: 'hello' })
    },

    async message(peer: Peer, message: { text: () => string }) {
      const text = message.text()
      const parsed = parseTerminalMessage(text)

      if (parsed?.type === 'attach') {
        try {
          const session = await options.attach(
            peer,
            parsed.sessionId,
            parsed.provider,
            parsed.baseBranch,
            parsed.featureId,
            parsed.cols,
            parsed.rows,
            Boolean(parsed.create)
          )
          sendTerminalControl(peer, { type: 'attached', sessionId: session.id })
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          peer.send(`\r\n[failed to attach tmux session: ${detail}]\r\n`)
          peer.close()
        }
        return
      }

      const session = options.sessionForPeer(peer)
      const pty = session?.peers.get(peer)
      if (!session || !pty) {
        peer.send('\r\n[terminal session is not attached]\r\n')
        return
      }

      if (parsed?.type === 'resize') {
        const cols = clampTerminalDimension(parsed.cols, DEFAULT_TERMINAL_COLS)
        const rows = clampTerminalDimension(parsed.rows, DEFAULT_TERMINAL_ROWS)
        if (cols === pty.cols && rows === pty.rows) return
        session.cols = cols
        session.rows = rows
        pty.resize(cols, rows)
        return
      }

      if (parsed?.type === 'submit' && typeof parsed.data === 'string' && parsed.data) {
        recordTerminalInput(session.id, `${parsed.data}\r`)
        session.turnMonitor.submitted()
        try {
          await submitPromptTurn(session.tmuxName, parsed.data)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          peer.send(`\r\n[failed to submit terminal prompt: ${detail}]\r\n`)
        }
        return
      }

      const input = parsed?.type === 'input' && typeof parsed.data === 'string' ? parsed.data : text
      if (!input) return
      recordTerminalInput(session.id, input)
      if (input.includes('\r') || input.includes('\n')) session.turnMonitor.submitted()
      pty.write(input)
    },

    close(peer: Peer) {
      options.detach(peer)
    }
  }
}

export function sendTerminalControl(
  peer: Peer,
  message: { type: 'hello' } | { type: 'attached'; sessionId: string } | { type: 'git-changed' }
) {
  peer.send(encodeTerminalControl(message))
}
