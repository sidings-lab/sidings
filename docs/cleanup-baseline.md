# Behavior-preserving cleanup baseline

Recorded on 2026-09-13 before structural cleanup. These values describe this
machine and checkout; elapsed time and RSS are comparison aids, not CI limits.

## Validation baseline

| Check | Result | Elapsed | Peak RSS |
| --- | --- | ---: | ---: |
| `bun test` | 288 passed, 0 failed, 30 files | 1.97 s | 99,704 KiB |
| `bun run typecheck` | passed | 5.37 s | 638,296 KiB |
| `bun run build` | passed | 6.45 s | 827,368 KiB |
| Production `.output` | 3,977,665 bytes (`du -sb`) | — | — |

The build reported 2.78 MB / 712 kB gzip for Nitro output. The largest client
chunks were 387.67 kB, 331.45 kB, and 113.60 kB before gzip.

`bun run verify-build` includes an HTTP smoke test that starts the built Nitro
server. The cleanup adds `bun run verify-build -- --static` for the same output
and native-asset assertions without launching Nitro; the full HTTP smoke test
remains available for the user to run manually.

## Polling and request contracts

- Active conversations: `GET /api/sessions` immediately during mount and every
  1,000 ms. Overlapping refreshes are coalesced; a request generation guard
  prevents an older response from replacing newer state.
- Git state: `GitWorkspace.poll()` immediately during mount and every 3,000 ms.
  The lightweight fingerprint endpoint triggers a graph reload only on change.
- Provider session-id discovery: starts 2,000 ms after tmux creation, repeats
  every 2,000 ms, and stops after 120,000 ms or deletion.
- Hook-less turn commit backstop: checks every 3,000 ms. TurnMonitor and job
  screen detection retain their existing provider-specific quiet windows.
- Claude CLI hooks: spool polling defaults to 100 ms and provides the preferred
  completion signal. Screen parsing remains the fallback and the Codex path.
- Commit-message query screen: refreshes every 500 ms while the query modal is
  active and is disposed when the query finishes or the composable unmounts.
- Database workspace requests are user-driven (connection list/schema load,
  save/test/delete, query, and draft persistence); there is no database poll.

## Coverage map

| Contract area | Existing characterization |
| --- | --- |
| Conversation attach/session switching | `conversation-terminal-state`, `shell-connection`, `app-shortcuts` |
| Provider resume and command construction | `provider-resume` |
| Terminal input, resize/protocol, Unicode | `tmux-input`, `terminal-protocol`, `provider-turn` |
| Provider state detection | `provider-turn`, `turn-monitor`, `cli-hook-monitor`, `cli-hooks` |
| Jobs and cancellation | `job-queue` |
| Worktrees and branch adoption | `worktrees`, `branch-follow`, `session-recovery` |
| Git parsing/actions/integration | `git-access`, `git-state`, `git-compare`, `preview-sync`, `session-squash`, `conflict-resolver` |
| Spec workflows | `spec-workflow`, `spec-workflow-runner`, `spec-batch-runner`, `traceability`, `skills` |
| Archives and persisted session metadata | `session-archive`, `session-title`, `session-preview`, `session-recovery` |
| Database query parsing/render safety | `sql-segments` (API integration remains manual) |

## Compatibility contracts

Cleanup must preserve API paths and payload fields, `~/.sidings` paths and JSON
schemas, NUL-prefixed terminal control frames, raw terminal data frames, tmux and
Git argument ordering, current error text, and timer intervals listed above.
Provider launch commands remain exactly:

- `codex --dangerously-bypass-approvals-and-sandbox`
- `claude --dangerously-skip-permissions`

The screen rules follow Herdr's evidence-based principle: inspect the current
bottom/live prompt region, treat working and blocking controls as higher-priority
evidence than an idle prompt, and avoid matching incidental historical output.

## Runtime resource ownership

- `useAppBrowserLifecycle` owns the global resize, media-query, and keyboard
  listeners plus the application polling loops; its unmount hook removes or
  stops each one.
- `ConversationWorkspace` owns both xterm composables. Their `dispose` methods
  disconnect resize observers and clipboard listeners, cancel fit timers and
  animation frames, close sockets, and dispose terminal addons.
- `DatabaseWorkspace` owns its draft debounce timer and flushes the current
  draft during unmount.
- `terminal-session` owns browser peer PTYs and cached-session disposal;
  `terminal-runtime` owns turn, CLI-hook, Git, and idle-commit monitors.
- Provider query tmux sessions use `finally` cleanup, while provider resume-id
  capture has an explicit per-session cancellation entry.

The reactivity audit found three deep component watchers. All watched values
are replaced as whole refs/props rather than mutated in place, so the deep
traversals were removed while retaining the same triggers. No filesystem,
Git, tmux, provider, or session response is cached; only identical in-flight
Git graph requests are coalesced by cwd, limit, and branch-filter signature.
Pure UI parsing and formatting remains behind Vue computed values, whose
reactive dependencies provide the invalidation boundary.

The dead-code audit used Nuxt typechecking with `--noUnusedLocals` and
`--noUnusedParameters`, repository-wide identifier searches, and production
build output. It removed obsolete locals and forwarding helpers; no CSS class
or variable was deleted without runtime visual evidence.

## Latest cleanup validation

Recorded on 2026-09-13 after the current cleanup stages:

| Check | Result | Elapsed |
| --- | --- | ---: |
| `bun test` | 319 passed, 0 failed, 39 files | 2.56 s |
| `bun run typecheck` | passed | — |
| `bun run build` | passed | 4.63 s wall time |
| Production `.output` | 3,995,222 bytes (`wc -c`) | — |
| Static entrypoint/build-script syntax and `git diff --check` | passed | — |
| `bun run verify-build -- --static` | 3 packaging checks passed | — |

`bun run verify-build -- --static` passed without starting the built Nitro
server. The full HTTP smoke portion remains reserved for user-run validation.
