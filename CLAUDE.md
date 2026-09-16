# Codex Instructions

do not execute server

## Language
- Use English for all user-facing application text, project documentation, code comments, and specifications.
- Keep identifiers and environment variable names stable unless a task explicitly includes a migration.

## Runtime Rules
- The user runs and tests the development server manually unless they ask for local validation.
- Use the package manager already represented by the lockfile.
- In temporary/worktree checkouts, do not create an independent dependency install. Link dependencies from the repository's main checkout with a symlink, for example `node_modules -> ~/src/code-cat/node_modules`.
- Preserve user changes in the working tree. Do not revert unrelated edits.

## Project Context
- Stack: Nuxt, Vue, TypeScript, Tailwind CSS, Nitro server routes, `node-pty`, and `tmux`.
- Product goal: a local web terminal for AI CLI conversations with provider selection, persisted session metadata, and isolated git worktrees.
- Session state is filesystem-backed under `~/.sidings` by default.
- New conversations are expected to run in managed worktrees and be removable with their tmux sessions and branches.

## Spec Workflow
- Specifications live under `specs/{feature-id}/spec.md`.
- Follow the Spec Kit style: describe user value, scenarios, functional requirements, key entities, success criteria, and assumptions.
- Every functional requirement must be testable.
- Keep specs in English.
