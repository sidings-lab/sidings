# Sidings

> The Git-native workbench for autonomous coding agents.

Sidings gives Claude Code, OpenAI Codex, and Antigravity their own Git worktrees and persistent tmux sessions, then brings them together in one local web dashboard. Run agents in parallel without polluting your main working tree, see which conversation needs attention, and review the resulting Git history and diffs in context.

The name comes from railways: the main branch is the main line; each managed worktree is a siding where an agent can work without blocking the other trains. tmux provides the signals and switching underneath, while Sidings provides the control room.

## Quickstart

Requirements: Node.js 20 or newer, Git, tmux, and at least one supported agent CLI installed and authenticated.

```bash
npx @sidings-lab/sidings@latest
```

Sidings opens `http://127.0.0.1:3000` in your browser and uses the current directory as the project. To choose another repository or avoid opening a browser:

```bash
npx @sidings-lab/sidings@latest --project ../my-project
npx @sidings-lab/sidings@latest --no-open --port 4173
```

Or install it globally:

```bash
npm install --global @sidings-lab/sidings
sidings
```

Session metadata remains local and is stored under `~/.sidings` by default.
Installations that predate the Sidings rename keep their state in `~/.spec-cat`;
the first run moves that directory to `~/.sidings`, repointing stored session
paths and relinking managed git worktrees. Nothing is merged: if `~/.sidings`
already exists, the legacy directory is left alone and a warning is logged.

## Why Sidings?

| Feature | Raw tmux | Cursor / IDE | Herdr (TUI) | **Sidings** |
| --- | :---: | :---: | :---: | :---: |
| Git worktree isolation | Manual | No | No | **Managed per conversation** |
| Large-prompt paste safety | Fragile input queue | N/A | CLI buffer | **Bracketed paste + settle delay** |
| Turn / blocked detection | Blind | Internal | Screen manifest | **Screen text + quiet window** |
| Interface | Terminal | Desktop GUI | TUI | **Local web dashboard** |
| Multi-agent workflow | Hand-written scripts | Single focus | Terminal panes | **Spec-driven batches** |

Sidings sends automated prompts through tmux's paste buffer instead of replaying thousands of individual keystrokes. It uses bracketed paste and a separate, delayed Enter frame, avoiding the partial-input stalls that can appear with large prompts. Turn monitoring combines provider signals, terminal screen text, and a quiet window rather than assuming that a silent process has finished.

## What you can do

- Start Claude Code, Codex, or Antigravity conversations from one dashboard.
- Isolate conversations in managed branches and worktrees.
- Keep sessions alive in tmux and recover them after restarting Sidings.
- Inspect branches, commits, working-tree changes, and file diffs beside the conversation.
- Run Spec Kit workflows and browserless automation jobs.
- Preview, rebase, squash, finalize, archive, restore, or remove conversation work.

## Develop locally

Sidings uses pnpm (see `pnpm-lock.yaml`).

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify-build
```

`pnpm verify-build` starts the packaged server briefly for smoke verification. Run it only when local server validation is appropriate.

## Security model

Sidings is a local, single-user developer tool. Agent CLIs execute with your user permissions inside selected repositories, so review commands and diffs before integrating them. The server binds to `127.0.0.1` by default; exposing it on another interface is an explicit choice.

## License

[MIT](LICENSE)
