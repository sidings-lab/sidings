# Implementation Plan: Git Graph Visualization

**Branch**: `002-git-graph` | **Date**: 2026-02-08 | **Spec**: `/specs/002-git-graph/spec.md`
**Input**: Full-featured git graph visualization with professional version control interface

## Summary

Implement a comprehensive git graph visualization feature modeled after vscode-git-graph, providing developers with a visual commit history graph, branch management, and git operations directly from the UI. The implementation uses SVG rendering in a table-based layout with 95 functional requirements covering visualization, operations, and workflow management.

## Technical Context

**Language/Version**: TypeScript 5.6+, Node.js 18+ (via Nuxt 3.16+ runtime)
**Primary Dependencies**: Nuxt 3.16+, Vue 3.5+, Pinia 2.2+, Tailwind CSS, @heroicons/vue
**Storage**: Git repository (filesystem), localStorage (UI preferences)
**Testing**: Vitest (existing test framework)
**Target Platform**: Desktop browsers (Chrome, Firefox, Safari)
**Project Type**: web - Nuxt 3 application with server-side git operations
**Performance Goals**: 300 commits initial load, <100ms UI response, 10s auto-refresh
**Constraints**: No external git libraries (direct CLI only), maintain scroll position on refresh
**Architecture**: Graph rendered as panel in Sidings layout, Git repository as server working directory
**Rendering**: SVG rendering for graph column (replacing previous Canvas approach)
**Git Operations**: Server-side via `child_process` git CLI wrappers
**Scale/Scope**: Support repos with 1000+ commits, 12-branch color palette, virtual scrolling

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- ✓ Uses existing stack (Nuxt 3, Vue 3, Pinia, Tailwind)
- ✓ No new external dependencies (git CLI wrapping only)
- ✓ Follows existing patterns (components/, stores/, server/api/)
- ✓ Maintains Sidings design system (retro-terminal theme)

## Project Structure

### Documentation (this feature)

```text
specs/002-git-graph/
├── plan.md              # This file (implementation design)
├── research.md          # Technical decisions and approach
├── data-model.md        # Type definitions and data structures
├── quickstart.md        # Implementation guide
├── spec.md              # Requirements specification
└── tasks.md             # Execution lanes index

specs/021-git-graph-rendering-core/  # Child execution lane
specs/022-git-graph-operations/      # Child execution lane
specs/023-git-graph-diff-viewer/     # Child execution lane
specs/024-git-graph-search-filter-ux/ # Child execution lane
```

### Source Code (repository root)

```text
types/
└── git.ts                 # Expanded with Tag, Stash, Remote, operations

server/
├── utils/
│   └── git.ts            # Git CLI wrapper functions
└── api/
    └── git/
        ├── log.get.ts    # Existing
        ├── show.get.ts   # Existing
        ├── status.get.ts # Existing
        ├── branch-*.ts   # NEW: 6 branch operation endpoints
        ├── cherry-pick.post.ts # NEW
        ├── revert.post.ts      # NEW
        ├── reset.post.ts       # NEW
        ├── tag*.ts             # NEW: 4 tag endpoints
        ├── stash*.ts           # NEW: 6 stash endpoints
        ├── remote*.ts          # NEW: 4 remote endpoints
        └── diff.get.ts         # NEW: comparison endpoint

components/
└── git/
    ├── GitGraph.vue              # Main container
    ├── GitCommitList.vue         # Virtual scrolling table
    ├── GitCommitRow.vue          # Row with SVG graph
    ├── GitCommitDetail.vue       # Detail panel
    ├── GitBranchMenu.vue         # Expanded context menu
    ├── GitCommitMenu.vue         # Expanded context menu
    ├── GitTagMenu.vue            # NEW
    ├── GitStashMenu.vue          # NEW
    ├── GitUncommittedMenu.vue    # NEW
    ├── GitContextMenu.vue        # NEW: Shared menu component
    ├── GitDialog.vue             # NEW: Shared dialog component
    └── dialogs/                  # NEW: Operation-specific dialogs
        ├── MergeDialog.vue
        ├── DeleteBranchDialog.vue
        ├── PushDialog.vue
        ├── CherryPickDialog.vue
        ├── ResetDialog.vue
        ├── TagCreateDialog.vue
        ├── TagDeleteDialog.vue
        └── StashDialog.vue

stores/
└── gitGraph.ts           # Expanded with new state

composables/
├── useGitGraph.ts        # SVG layout algorithm (migrate from Canvas)
├── useAutoRefresh.ts     # Existing polling mechanism
└── useKeyboardShortcuts.ts # NEW: Keyboard handling

utils/
└── commitMessage.ts      # NEW: Message rendering utilities
```

**Structure Decision**: Web application structure leveraging existing Nuxt 3 patterns. Server-side git operations via CLI wrappers, client-side Vue components with Pinia state management.

## Implementation Approach

### 1. Graph Rendering (FR-001 to FR-012)
- **SVG-based rendering**: Each table row contains inline SVG for its graph segment
- **Table layout**: CSS Grid with columns: Graph | Description | Date | Author | Commit
- **Lane algorithm**: Mainline-first with lane recycling, HEAD chain on lane 0
- **Bezier curves** for rounded style, straight lines for angular style
- **12-color palette** with deterministic assignment via string hashing

### 2. Git Operations Architecture (FR-023 to FR-076)
- **Server-side execution**: All git commands via `child_process.execFileSync`
- **30+ new API endpoints** for branch, commit, tag, stash, and remote operations
- **Request validation**: Zod schemas for operation parameters
- **Error handling**: Git command errors propagated with user-friendly messages
- **Confirmation dialogs** for destructive operations

### 3. UI Component Architecture
- **Context menus**: 6 entity-specific menus with shared base component
- **Modal dialogs**: 9 operation-specific dialogs for user input
- **Virtual scrolling**: Only visible rows render, 300 initial + 100 incremental
- **Column resizing**: Drag handles with mousemove tracking
- **Keyboard shortcuts**: Non-overriding shortcuts, preserve browser defaults

### 4. State Management
- **Pinia store**: Central state for commits, branches, tags, stashes, UI state
- **Lazy loading**: Commit details fetched on selection
- **Cache layer**: Search results cached (max 10 entries)
- **Auto-refresh**: 10-second polling with interaction deferral

### 5. Performance Optimizations
- **Progressive loading**: 300 initial commits, 100 on scroll
- **Virtual scrolling**: Render only visible rows
- **SVG pre-computation**: Path data calculated once per layout
- **Debounced search**: 300ms delay on input
- **State comparison**: Skip redraws when no changes detected

## Key Design Decisions

1. **SVG over Canvas**: Per-element interactivity for tooltips, cleaner High DPI support
2. **Table over custom layout**: Matches vscode-git-graph, native column resize
3. **CLI over libraries**: Direct git execution, no abstraction layer
4. **Polling over WebSocket**: Simpler implementation, adequate for 10s refresh
5. **Child execution lanes**: Parallel development of rendering, operations, diff viewer, search/filter

## Generated Artifacts

- `research.md`: Technical decisions on rendering, algorithms, architecture
- `data-model.md`: Complete type definitions for 95 FRs
- `quickstart.md`: Step-by-step implementation guide
- Child spec lanes for parallel execution

## Complexity Tracking

No violations - implementation uses existing stack and patterns.

## FR Coverage Matrix

This matrix maps functional requirements to implementation components and design decisions.

### Graph Rendering & Display (FR-001 to FR-012)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-001 | CSS Grid table with SVG graph column | GitCommitList.vue, GitCommitRow.vue |
| FR-002 | SVG path rendering with configurable style | useGitGraph.ts (Bezier/straight paths) |
| FR-003 | 12-color palette with string hashing | types/git.ts (BRANCH_COLORS constant) |
| FR-004 | Commit metadata display formatting | GitCommitRow.vue (truncation, date format) |
| FR-005 | SVG circle nodes with type indicators | GitCommitRow.vue (nodeType styling) |
| FR-006 | Reference label badges | GitCommitRow.vue (branch/tag badges) |
| FR-007 | Branch label grouping logic | GitCommitRow.vue (local/remote grouping) |
| FR-008 | Tag badge styling | GitCommitRow.vue (distinct from branches) |
| FR-009 | HEAD highlighting | gitGraph.ts store (isHead flag) |
| FR-010 | Uncommitted changes row | GitCommitList.vue (special first row) |
| FR-011 | Opacity muting for commits | GitCommitRow.vue (50% opacity CSS) |
| FR-012 | SVG High DPI support | Native SVG scaling |

### Commit Details View (FR-013 to FR-022)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-013 | Full commit details display | GitCommitDetail.vue |
| FR-014 | File Tree/List toggle | GitCommitDetail.vue (viewMode state) |
| FR-015 | File status color badges | GitCommitDetail.vue (FILE_STATUS_CONFIG) |
| FR-016 | Rename path display | GitCommitDetail.vue (oldPath → newPath) |
| FR-017 | Commit statistics | GitCommitDetail.vue (stats section) |
| FR-018 | Arrow key navigation | GitCommitDetail.vue (keyboard handler) |
| FR-019 | Parent/child navigation | useKeyboardShortcuts.ts |
| FR-020 | Detail view positioning | GitCommitDetail.vue (position prop) |
| FR-021 | Two-commit comparison | gitGraph.ts (comparisonCommit state) |
| FR-022 | Uncommitted comparison | server/api/git/diff.get.ts |

### Branch Operations (FR-023 to FR-032)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-023 | Checkout branch | GitBranchMenu.vue → branch-checkout.post.ts |
| FR-024 | Rename branch | GitBranchMenu.vue → branch-rename.post.ts |
| FR-025 | Delete branch | DeleteBranchDialog.vue → branch-delete.post.ts |
| FR-026 | Merge branch | MergeDialog.vue → merge.post.ts |
| FR-027 | Rebase branch | GitBranchMenu.vue → rebase.post.ts |
| FR-028 | Push branch | PushDialog.vue → push.post.ts |
| FR-029 | Pull branch | GitBranchMenu.vue → pull.post.ts |
| FR-030 | Fetch branch | GitBranchMenu.vue → fetch.post.ts |
| FR-031 | Create branch | GitCommitMenu.vue → branch-create.post.ts |
| FR-032 | Copy branch name | GitBranchMenu.vue (clipboard API) |

### Commit Operations (FR-033 to FR-039)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-033 | Checkout commit | GitCommitMenu.vue → checkout.post.ts |
| FR-034 | Cherry-pick | CherryPickDialog.vue → cherry-pick.post.ts |
| FR-035 | Revert commit | GitCommitMenu.vue → revert.post.ts |
| FR-036 | Merge commit | GitCommitMenu.vue → merge.post.ts |
| FR-037 | Reset to commit | ResetDialog.vue → reset.post.ts |
| FR-038 | Copy commit hash | GitCommitMenu.vue (clipboard API) |
| FR-039 | Copy subject | GitCommitMenu.vue (clipboard API) |

### Tag Operations (FR-040 to FR-044)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-040 | Create tag | TagCreateDialog.vue → tag.post.ts |
| FR-041 | Delete tag | TagDeleteDialog.vue → tag.delete.ts |
| FR-042 | Push tag | GitTagMenu.vue → tag-push.post.ts |
| FR-043 | View tag details | GitTagMenu.vue → tag/[name].get.ts |
| FR-044 | Copy tag name | GitTagMenu.vue (clipboard API) |

### Stash Operations (FR-045 to FR-051)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-045 | Display stashes | server/api/git/stash.get.ts |
| FR-046 | Apply stash | GitStashMenu.vue → stash-apply.post.ts |
| FR-047 | Pop stash | GitStashMenu.vue → stash-pop.post.ts |
| FR-048 | Drop stash | GitStashMenu.vue → stash-drop.post.ts |
| FR-049 | Branch from stash | GitStashMenu.vue → stash-branch.post.ts |
| FR-050 | Create stash | StashDialog.vue → stash.post.ts |
| FR-051 | Copy stash info | GitStashMenu.vue (clipboard API) |

### Uncommitted Changes & Staging (FR-052 to FR-057)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-052 | Separate sections | GitUncommittedDetail.vue |
| FR-053 | Stage/unstage files | stage.post.ts, unstage.post.ts |
| FR-054 | Stage/unstage all | stage-all.post.ts, unstage-all.post.ts |
| FR-055 | Commit with Ctrl+Enter | GitUncommittedDetail.vue → commit.post.ts |
| FR-056 | Rename detection | server/utils/git.ts (git status parsing) |
| FR-057 | Uncommitted menu | GitUncommittedMenu.vue |

### Search & Filter (FR-058 to FR-062)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-058 | Find Widget | GitFindWidget.vue |
| FR-059 | Search highlighting | GitCommitList.vue (match highlighting) |
| FR-060 | Branch filter | GitBranchFilter.vue (multi-select) |
| FR-061 | Search debounce | useDebounce composable (300ms) |
| FR-062 | Search cache | gitGraph.ts (searchCache Map) |

### Auto-refresh & Performance (FR-063 to FR-069)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-063 | State polling | useAutoRefresh.ts → state.get.ts |
| FR-064 | Preserve UI state | gitGraph.ts (selection preservation) |
| FR-065 | Defer during interaction | useAutoRefresh.ts (interaction flags) |
| FR-066 | Skip unchanged redraws | useAutoRefresh.ts (state comparison) |
| FR-067 | Progressive loading | GitCommitList.vue (300/100 constants) |
| FR-068 | Virtual scrolling | GitCommitList.vue (vue-virtual-scroller) |
| FR-069 | Last updated indicator | GitGraph.vue (relative time display) |

### Toolbar & Controls (FR-070 to FR-076)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-070 | Toolbar components | GitToolbar.vue |
| FR-071 | Column visibility | gitGraph.ts (columns state) |
| FR-072 | Column resizing | GitCommitList.vue (resize handlers) |
| FR-073 | Label alignment | gitGraph.ts (refLabelAlignment) |
| FR-074 | Remote list | server/api/git/remotes.get.ts |
| FR-075 | Fetch all | server/api/git/fetch-all.post.ts |
| FR-076 | Remote management | remote.post/put/delete.ts |

### Keyboard & UI Features (FR-077 to FR-095)
| FR | Implementation | Component/File |
|----|----------------|----------------|
| FR-077 | Find via toolbar | GitToolbar.vue (no Ctrl+F override) |
| FR-078 | Ctrl+H scroll | useKeyboardShortcuts.ts |
| FR-079 | Refresh via toolbar | GitToolbar.vue (no Ctrl+R override) |
| FR-080 | Ctrl+S stash scroll | useKeyboardShortcuts.ts |
| FR-081 | Escape handling | useKeyboardShortcuts.ts (cascade) |
| FR-082 | Enter submit | Dialog components |
| FR-083 | URL linkification | utils/commitMessage.ts |
| FR-084 | Emoji shortcodes | utils/commitMessage.ts (emoji map) |
| FR-085 | Markdown rendering | utils/commitMessage.ts (marked) |
| FR-086 | GPG signatures | GitCommitRow.vue (signature badge) |
| FR-087 | Open diff viewer on file click | GitDiffViewer.vue → diff/[file].get.ts |
| FR-088 | Overlay right panels layout | GitDiffViewer.vue (CSS overlay positioning) |
| FR-089 | Unified diff display | GitDiffViewer.vue (line numbers, highlighting) |
| FR-090 | Diff viewer header | GitDiffViewer.vue (file path, status, hash) |
| FR-091 | Close via button/Escape | GitDiffViewer.vue (event handlers) |
| FR-092 | Switch files in-place | gitGraph.ts (selectedFile state) |
| FR-093 | Binary file indicator | GitDiffViewer.vue (binary detection) |
| FR-094 | Fetch diff from server | server/api/git/diff/[file].get.ts |
| FR-095 | Feature highlight | GitCommitList.vue (feature branch styling) |

