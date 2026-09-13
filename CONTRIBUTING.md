# Contributing to Sidings

Thank you for helping improve Sidings. Bug reports, small focused fixes, platform compatibility findings, and new provider research are especially useful.

## Before opening a change

- Search existing issues and pull requests.
- For substantial behavior changes, open an issue first so the user experience and compatibility constraints can be agreed on.
- Never include API keys, private prompts, repository content, or files from `~/.spec-cat` in an issue or fixture.

## Local development

Requirements are Node.js 20 or newer, pnpm, Git, and tmux. Agent-specific changes also require the relevant CLI.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify-build
```

The final command briefly starts the packaged application for a localhost smoke test. Skip it when server execution is inappropriate, or use `pnpm verify-build -- --static` to check only packaged files and native node-pty assets.

## Pull requests

- Keep user-facing text, documentation, specifications, and code comments in English.
- Add or update tests for behavior changes.
- Preserve the existing `SPEC_CAT_*` variables, `code-cat-*` browser keys, and `~/.spec-cat` paths unless the change explicitly includes a migration.
- Explain platform assumptions, especially for tmux, node-pty, macOS, Linux, and WSL behavior.
- Keep unrelated refactors out of the change.

By contributing, you agree that your contribution is licensed under the MIT License.
