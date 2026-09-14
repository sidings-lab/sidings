<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'
import type { ProviderId, SessionListItem } from '~/types/session'
import type {
  ShellSessionInfo,
} from '~/types/app'
import type { ConversationWorkspaceExpose, GitWorkspaceExpose, SpecWorkspaceExpose } from '~/types/workspace'
import { rainglowThemes } from '~/assets/rainglow/themes'
import { getThemeVars, getXtermTheme as createXtermTheme } from '~/utils/rainglow-theme'
import { runTopmostModalHandler } from '~/utils/modal-stack'
import { filterActiveConversations, filterArchivedConversations } from '~/utils/conversation-filter'
import { resolveInitialSessionAction } from '~/utils/session-resolution'
const GIT_GRAPH_STATE_KEY = 'code-cat-git-graph-state'

const appReady = ref(false)
const specWorkspaceRef = ref<SpecWorkspaceExpose | null>(null)
const gitWorkspaceRef = ref<GitWorkspaceExpose | null>(null)
const sessions = ref<SessionListItem[]>([])
const selectedArchivedSessionId = ref('')
const selectedThemeName = ref('peacock')
const defaultProvider = ref<ProviderId>('claude')
const appVersion = useRuntimeConfig().public.appVersion as string
// Button-only modals focus their primary action on open so Enter triggers it
// natively (there is no text field to carry an implicit form submit).
const integrationError = ref('')
const activeSidebarPanel = ref<'conversations' | 'terminal'>('conversations')
const databaseOpen = ref(false)
const sidebarCollapsed = ref(false)
// The spec browser is a permanent column between the activity bar and the
// conversation list rather than a sidebar tab: spec work drives the
// conversations, so it must stay visible while one is open.
const specPanelCollapsed = ref(false)
// ⌘⌥L / Ctrl+Alt+L toggles the chat column between its default width and a maximized width
// that swallows the spec browser and conversation list tracks. The Git column
// stays visible so the graph keeps its context.
const chatMaximized = ref(false)
// Narrow viewports (phones) can't fit the side-by-side panels, so below this
// width each panel goes full-width and only one shows at a time (see
// appGridColumns and the panels' mobile overlay classes).
const isMobile = ref(false)
// A phone-width terminal fits far fewer columns at the desktop size, so the
// TUI wraps badly; shrink the font on mobile to fit more columns.
const TERMINAL_FONT_SIZE = 14
const TERMINAL_FONT_SIZE_MOBILE = 11
const terminalFontSize = computed(() => (isMobile.value ? TERMINAL_FONT_SIZE_MOBILE : TERMINAL_FONT_SIZE))

// The repository is always the first piece of context. Keep the graph mounted
// as the left-most column.
const gitGraphState = ref<'floating' | 'pinned'>('pinned')
const gitGraphPinned = computed({
  get: () => gitGraphState.value === 'pinned',
  set: (pinned: boolean) => { gitGraphState.value = pinned ? 'pinned' : 'floating' }
})

const { gitDialog, openGitDialog, confirmGitDialog, cancelGitDialog } = useGitDialog()

const conversationSearchQuery = ref('')
// Soft cap: each conversation holds a tmux session, a worktree and a branch,
// so warn before the list grows unwieldy.
const MAX_CONVERSATIONS = 30
const conversationLimitWarning = computed(() => {
  const count = sessions.value.length
  if (count >= MAX_CONVERSATIONS) {
    return `Conversation limit reached (${count}/${MAX_CONVERSATIONS}). Archive or finalize old conversations.`
  }
  if (count >= Math.floor(MAX_CONVERSATIONS * 0.8)) {
    return `Approaching the conversation limit (${count}/${MAX_CONVERSATIONS}).`
  }
  return ''
})

const { toasts, pushToast, dismissToast, disposeToasts } = useToastStack()
const { writeClipboard } = useTerminalClipboard(pushToast)
const conversationWorkspaceRef = ref<ConversationWorkspaceExpose | null>(null)
const sessionId = ref('')
const status = ref<'connecting' | 'connected' | 'closed'>('closed')
const shells = ref<ShellSessionInfo[]>([])
const loadingShells = ref(false)
const creatingShell = ref(false)
const activeShellId = ref('')
usePanelPersistence({ activeSidebarPanel, sidebarCollapsed, specPanelCollapsed, activeShellId })
const {
  connect, sendTerminalCommand, sendTerminalText, isTerminalConnected,
  closeConversationTerminal, resetConversationTerminal, setConversationCursorBlink,
  writeConversationTerminal, writelnConversationTerminal, setWorkspaceSessionId,
  clearWorkspaceSessionId, getInitialSessionId, scheduleTerminalFit, scheduleShellFit,
  settleTerminalFit, refreshShells, createShell, killShell, selectShell
} = useConversationWorkspaceBridge(conversationWorkspaceRef)
const setSessionId = (value: string) => { sessionId.value = value; setWorkspaceSessionId(value) }
const clearSessionId = () => { sessionId.value = ''; clearWorkspaceSessionId() }
const { selectSession, selectArchivedSession } = useConversationSelection({
  sessions, sessionId, selectedArchivedSessionId, isMobile, sidebarCollapsed, specPanelCollapsed,
  activeSidebarPanel, status, connect, closeTerminal: closeConversationTerminal,
  resetTerminal: resetConversationTerminal, setCursorBlink: setConversationCursorBlink,
  setSessionId, writeTerminal: writeConversationTerminal,
  writelnTerminal: writelnConversationTerminal
})
const { loadingSessions, refreshSessions } = useSessionPollingController({
  sessions,
  activeSessionId: sessionId,
  trackSessionState: (session, state) => specWorkspaceRef.value?.trackSessionState(session, state),
  sessionLabel: (session) => sessionDisplayName(session),
  pushToast
})
const {
  archivedSessions, loadingArchived, showArchivedSessions, archivingSessionId,
  restoringSessionId, deletingSessionId, editingSessionId, editingSessionTitle,
  sessionDisplayName, startSessionRename, cancelSessionRename,
  saveSessionRename, refreshArchivedSessions, toggleArchivedSessions, archiveSession,
  restoreArchivedSession, deleteArchivedSession, deleteAllArchivedSessions
} = useSessionArchive({
  sessions, sessionId, clearSessionId, selectedArchivedSessionId, refreshSessions, selectSession, connect,
  closeTerminal: closeConversationTerminal, resetTerminal: resetConversationTerminal,
  writelnTerminal: writelnConversationTerminal, openDialog: openGitDialog, pushToast
})
const pendingFeatureAction = computed({
  get: () => specWorkspaceRef.value?.getPendingAction() || null,
  set: (value) => { if (!value) specWorkspaceRef.value?.clearPendingAction() }
})
const pendingFeatureActionLabel = computed(() => specWorkspaceRef.value?.getPendingActionLabel() || '')
const skillPreparationLabel = computed(() => specWorkspaceRef.value?.getSkillPreparationLabel() || '')
const {
  showNewSessionModal, showSettingsModal, sessionOptions, loadingSessionOptions,
  creatingSession, newSessionProvider, newSessionBaseBranch, newSessionBaseBranchRef,
  settingsDoneRef, settingsProviderOptions, loadSessionOptions,
  openNewSessionModal: openNewSessionDialog, openSettingsModal, createNewSession
} = useNewSession({
  defaultProvider, sessionId, clearSessionId, pendingAction: pendingFeatureAction,
  pendingActionLabel: pendingFeatureActionLabel, integrationError, connect,
  waitForAttached: () => specWorkspaceRef.value?.waitForNewSessionAttached() || Promise.resolve(''),
  waitForIdle: (id) => specWorkspaceRef.value?.waitForSessionIdle(id) || Promise.resolve(false),
  dispatchAction: (action, freshConversation) => specWorkspaceRef.value?.dispatchFeatureAction(action, freshConversation), refreshSessions, pushToast
})
const { loadAppSettings, persistAppSettings, disposeAppSettings } = useAppSettings({
  selectedThemeName, gitGraphState, defaultProvider, newSessionProvider, isMobile,
  isKnownTheme: (name) => rainglowThemes.some((theme) => theme.name === name)
})

function openNewSessionModal() {
  return openNewSessionDialog()
}
const { startPolling, stopPolling } = useAppPolling({
  refreshSessions,
  pollGitState: () => gitWorkspaceRef.value?.poll()
})

const statusText = computed(() => {
  if (selectedArchivedSessionId.value) return 'Read-only'
  if (status.value === 'connected') return 'Connected'
  if (status.value === 'connecting') return 'Connecting'
  return 'Closed'
})

const activeSession = computed(() => {
  if (selectedArchivedSessionId.value) {
    return archivedSessions.value.find((session) => session.id === selectedArchivedSessionId.value)
  }
  return sessions.value.find((session) => session.id === sessionId.value)
})

const previewingSession = computed(() => {
  return sessions.value.find((session) => Boolean(session.previewBranch)) || null
})

const isActiveSessionPreviewing = computed(() => {
  return Boolean(activeSession.value?.previewBranch)
})

const canPreviewActiveSession = computed(() => {
  return Boolean(activeSession.value && !activeSession.value.archived && !activeSession.value.finalized && activeSession.value.worktreeBranch && activeSession.value.baseBranch)
})

const appGridColumns = computed(() => {
  // On mobile the sidebar and git graph overlay the main column instead of
  // reserving a track, so the grid is just the activity bar plus one panel.
  if (isMobile.value) return '48px minmax(0,1fr)'
  // Maximized chat drops the spec and conversation tracks entirely; the chat
  // column takes the space they used to occupy.
  if (chatMaximized.value) return 'minmax(0,3fr) minmax(0,7fr)'
  // Match the 30 / 20 / 20 / 30 information architecture. The elements
  // are assigned to these tracks with CSS so their implementation can remain
  // exactly where it is in this (intentionally monolithic) component.
  // The tracks carry no pixel floor on purpose: a floor larger than the
  // viewport pushes the chat column past the workspace's overflow-hidden
  // edge, where it is invisible and unclickable on smaller desktop windows.
  return 'minmax(0,3fr) minmax(0,2fr) minmax(0,2fr) minmax(0,3fr)'
})


const {
  showIntegrationModal, integrationMode, integrationBaseBranch, integrationCommitMessage,
  integrationRunning, generatingCommitMessage, commitQueryScreen, conflictReport,
  showConflictReport, previewRunning, previewError, branchReviewRunning,
  integrationBaseBranchRef, conflictCloseRef, openIntegrationModal, generateCommitMessage,
  runSessionIntegration, injectBranchReviewPrompt, toggleSessionPreview
} = useSessionIntegration({
  activeSession, previewingSession, canPreviewActiveSession, sessions, sessionId, clearSessionId,
  sessionOptions, integrationError, loadSessionOptions, refreshSessions,
  refreshArchivedSessions, refreshGitGraph: async () => { await gitWorkspaceRef.value?.refresh() },
  waitForSessionIdle: (id, timeout) => specWorkspaceRef.value?.waitForSessionIdle(id, timeout) || Promise.resolve(false), isTerminalConnected,
  sendTerminalCommand, sendTerminalText, closeTerminal: closeConversationTerminal,
  resetTerminal: resetConversationTerminal, writelnTerminal: writelnConversationTerminal,
  connect, pushToast
})

const {
  handleGlobalEscape, handleGlobalEnter, handleChatMaximizeShortcut,
  handleWorkspacePanelShortcut, handleToggleSidebarShortcut, handleNewConversationShortcut,
  openChatPanel, openTerminalPanel, openDatabasePanel, selectSidebarPanel, openSpecPanel
} = useAppShortcuts({
  activePanel: activeSidebarPanel, databaseOpen, sidebarCollapsed, specPanelCollapsed,
  chatMaximized, isMobile, newSessionOpen: showNewSessionModal,
  integrationOpen: showIntegrationModal, closeTopmostModal,
  closeDiffPreview: () => gitWorkspaceRef.value?.closeDiffPreview(),
  hasDiffPreview: () => Boolean(gitWorkspaceRef.value?.hasDiffPreview()),
  submitTopmostModal, createShell, openNewSessionModal
})

const filteredSessions = computed(() => {
  return filterActiveConversations(sessions.value, conversationSearchQuery.value)
})

const filteredArchivedSessions = computed(() => {
  return filterArchivedConversations(archivedSessions.value, conversationSearchQuery.value)
})

/**
 * True when a conversation's worktree branch IS this feature's branch. A
 * speckit step checks out `042-some-feature` inside the worktree and the server
 * makes the conversation follow it (server/utils/branch-follow.ts), so the
 * branch is the authoritative feature↔conversation link. Branch layouts that
 * namespace the feature (`feature/042-some-feature`) match on the last segment.
 */
const selectedTheme = computed(() => {
  return rainglowThemes.find((theme) => theme.name === selectedThemeName.value) || rainglowThemes[0]!
})

const themeColors = computed(() => selectedTheme.value.colors)

const themeVars = computed(() => getThemeVars(themeColors.value))

useAppBrowserLifecycle({
  appReady, isMobile, gitGraphState, specPanelCollapsed, sidebarCollapsed, activeSidebarPanel,
  scheduleTerminalFit, scheduleShellFit, settleTerminalFit, startPolling, stopPolling,
  disposeAppSettings, disposeToasts, handleChatMaximizeShortcut,
  handleWorkspacePanelShortcut, handleNewConversationShortcut, handleGlobalEscape,
  handleGlobalEnter, handleToggleSidebarShortcut,
  initialize: async () => {
    await Promise.allSettled([loadAppSettings(), loadSessionOptions(), refreshSessions(), refreshArchivedSessions(), refreshShells()])
    const resolution = resolveInitialSessionAction(
      getInitialSessionId(),
      sessions.value,
      archivedSessions.value
    )
    if (resolution.action === 'connect') {
      connect(resolution.sessionId)
    } else if (resolution.action === 'select') {
      selectSession(resolution.sessionId)
    } else if (resolution.action === 'selectArchived') {
      void selectArchivedSession(resolution.session)
    } else {
      clearSessionId()
      closeConversationTerminal()
    }
  }
})

watch(selectedThemeName, () => {
  window.localStorage.setItem('claude-web-rainglow-theme', selectedThemeName.value)
  persistAppSettings()
})


watch([gitGraphPinned, chatMaximized], () => scheduleTerminalFit(120), { flush: 'post' })

watch(gitGraphState, (state) => {
  window.localStorage.setItem(GIT_GRAPH_STATE_KEY, state)
  persistAppSettings()
})

watch(defaultProvider, () => {
  persistAppSettings()
})

// Crossing the mobile breakpoint (rotate/resize) restyles the live terminals
// and re-fits them so the pty is resized to the new column count. The explicit
// refresh forces the WebGL renderer to repaint at the new glyph size instead of
// reusing its cached atlas.
watch(terminalFontSize, async () => { await nextTick(); scheduleTerminalFit() })

onBeforeMount(() => {
  const stored = window.localStorage.getItem('claude-web-rainglow-theme')
  if (stored && rainglowThemes.some((theme) => theme.name === stored)) {
    selectedThemeName.value = stored
  }

})

// Below the mobile breakpoint the spec browser and the sidebar are both
// full-width overlays stacked at the same depth, so only one may be up.
watch(isMobile, (mobile) => {
  if (mobile && !sidebarCollapsed.value) specPanelCollapsed.value = true
})

// Close the frontmost open modal, ordered by stacking priority (higher
// z-index first). Returns true when something was closed. Centralizing this
// makes Escape work regardless of where focus sits — the per-modal handlers
// only fired when focus happened to be inside the modal.
function closeTopmostModal(): boolean {
  return runTopmostModalHandler({
    gitDialog: () => { if (!gitDialog.value) return false; cancelGitDialog(); return true },
    worktrees: () => Boolean(gitWorkspaceRef.value?.closeHighPriorityModal()),
    spec: () => Boolean(specWorkspaceRef.value?.closeTopmost()),
    remotes: () => Boolean(gitWorkspaceRef.value?.closeModal()),
    integration: () => { if (!showIntegrationModal.value) return false; showIntegrationModal.value = false; return true },
    conflictReport: () => { if (!showConflictReport.value) return false; showConflictReport.value = false; return true },
    newSession: () => { if (!showNewSessionModal.value) return false; showNewSessionModal.value = false; return true },
    settings: () => { if (!showSettingsModal.value) return false; showSettingsModal.value = false; return true }
  })
}

function submitTopmostModal(): boolean {
  return runTopmostModalHandler({
    gitDialog: () => { if (!gitDialog.value) return false; confirmGitDialog(); return true },
    worktrees: () => Boolean(gitWorkspaceRef.value?.submitHighPriorityModal()),
    spec: () => Boolean(specWorkspaceRef.value?.submitTopmost()),
    remotes: () => Boolean(gitWorkspaceRef.value?.submitModal()),
    integration: () => { if (!showIntegrationModal.value) return false; void runSessionIntegration(); return true },
    conflictReport: () => { if (!showConflictReport.value) return false; showConflictReport.value = false; return true },
    newSession: () => { if (!showNewSessionModal.value) return false; void createNewSession(); return true },
    settings: () => { if (!showSettingsModal.value) return false; showSettingsModal.value = false; return true }
  })
}

async function copyText(value: string) {
  if (await writeClipboard(value)) {
    pushToast('success', 'Copied to clipboard.', 2000)
  } else {
    pushToast('error', 'Could not copy to clipboard.', 4000)
  }
}

function closeFloatingMenus() {
  gitWorkspaceRef.value?.closeFloatingMenus()
}

function getXtermTheme() {
  return createXtermTheme(themeColors.value)
}
</script>

<template>
  <main
    class="app-shell h-screen h-dvh w-screen max-w-full overflow-hidden bg-[var(--rg-editor)] text-[var(--rg-foreground)]"
    :style="themeVars"
    @click="closeFloatingMenus"
  >
    <section class="grid h-full min-h-0 grid-rows-[30px_minmax(0,1fr)_22px] overflow-hidden">
      <AppTopBar
        :project-name="sessionOptions.projectName"
        :active-session="activeSession"
        :active-sidebar-panel="activeSidebarPanel"
        :database-open="databaseOpen"
        :chat-maximized="chatMaximized"
        :mobile="isMobile"
        @open-chat="openChatPanel"
        @open-terminal="openTerminalPanel"
        @open-database="openDatabasePanel"
        @toggle-chat-maximized="chatMaximized = !chatMaximized"
        @refresh="activeSidebarPanel === 'terminal' ? refreshShells() : refreshSessions()"
        @open-settings="openSettingsModal"
      />

      <section
        class="brick-workspace relative grid min-h-0 min-w-0 overflow-hidden"
        :class="chatMaximized ? 'brick-chat-max' : ''"
        :style="{ gridTemplateColumns: appGridColumns }"
      >
        <AppActivityBar
          :sidebar-collapsed="sidebarCollapsed"
          :spec-panel-collapsed="specPanelCollapsed"
          :active-sidebar-panel="activeSidebarPanel"
          :database-open="databaseOpen"
          @select-sidebar-panel="selectSidebarPanel"
          @open-spec-panel="openSpecPanel"
          @toggle-database="databaseOpen = !databaseOpen"
          @refresh="activeSidebarPanel === 'terminal' ? refreshShells() : refreshSessions()"
          @open-settings="openSettingsModal"
        />
        <DatabaseWorkspace v-if="databaseOpen" @close="databaseOpen = false" />
        <SpecWorkspace
          ref="specWorkspaceRef"
          :collapsed="specPanelCollapsed"
          :mobile="isMobile"
          :sessions="sessions"
          :session-id="sessionId"
          :status="status"
          :active-provider="activeSession?.provider"
          :theme-vars="themeVars"
          :push-toast="pushToast"
          :select-session="selectSession"
          :open-new-session="openNewSessionModal"
          :send-command="sendTerminalCommand"
          :send-text="sendTerminalText"
        />
        <AppSidebarPanel v-model:conversation-search-query="conversationSearchQuery"
          v-model:editing-session-title="editingSessionTitle" :collapsed="sidebarCollapsed" :mobile="isMobile"
          :active-sidebar-panel="activeSidebarPanel" :conversation-limit-warning="conversationLimitWarning"
          :sessions="sessions" :filtered-sessions="filteredSessions" :loading-sessions="loadingSessions"
          :session-id="sessionId" :editing-session-id="editingSessionId" :archiving-session-id="archivingSessionId"
          :show-archived-sessions="showArchivedSessions" :archived-sessions="archivedSessions"
          :filtered-archived-sessions="filteredArchivedSessions" :loading-archived="loadingArchived"
          :selected-archived-session-id="selectedArchivedSessionId" :restoring-session-id="restoringSessionId"
          :deleting-session-id="deletingSessionId" :shells="shells" :loading-shells="loadingShells"
          :creating-shell="creatingShell" :active-shell-id="activeShellId" :status-text="statusText"
          :active-session="activeSession" :session-display-name="sessionDisplayName"
          @open-new-session-modal="openNewSessionModal" @refresh-sessions="refreshSessions" @refresh-shells="refreshShells"
          @select-session="selectSession" @save-session-rename="saveSessionRename" @cancel-session-rename="cancelSessionRename"
          @start-session-rename="startSessionRename" @archive-session="archiveSession" @copy-text="copyText"
          @toggle-archived-sessions="toggleArchivedSessions" @delete-all-archived-sessions="deleteAllArchivedSessions"
          @select-archived-session="selectArchivedSession" @restore-archived-session="restoreArchivedSession"
          @delete-archived-session="deleteArchivedSession" @create-shell="createShell" @select-shell="selectShell" @kill-shell="killShell" />
        <ConversationWorkspace ref="conversationWorkspaceRef" :active-session="activeSession" :session-id="sessionId"
          :initial-shell-id="activeShellId"
          :active-panel="activeSidebarPanel" :preview-running="previewRunning" :preview-error="previewError"
          :skill-preparation-label="skillPreparationLabel"
          :branch-review-running="branchReviewRunning" :can-preview="canPreviewActiveSession"
          :is-previewing="isActiveSessionPreviewing" :font-size="terminalFontSize" :terminal-theme="getXtermTheme()"
          :push-toast="pushToast" :active-provider="activeSession?.provider" @toggle-preview="toggleSessionPreview"
          @open-integration="openIntegrationModal" @review-branch="injectBranchReviewPrompt"
          @attached="(id) => { sessionId = id; refreshSessions() }"
          @git-changed="() => { gitWorkspaceRef?.invalidate(); refreshSessions(); gitWorkspaceRef?.refresh() }"
          @status-changed="status = $event"
          @shell-state-changed="({ shells: nextShells, loading, creating, activeId }) => { shells = nextShells; loadingShells = loading; creatingShell = creating; activeShellId = activeId }" />
        <GitWorkspace ref="gitWorkspaceRef" v-model:pinned="gitGraphPinned" :active-session="activeSession"
          :previewing-session="previewingSession" :mobile="isMobile" :theme-vars="themeVars"
          :open-dialog="openGitDialog" :push-toast="pushToast" :write-clipboard="writeClipboard" />
      </section>
      <AppStatusBar v-model:selected-theme-name="selectedThemeName" :themes="rainglowThemes" :mobile="isMobile"
        :session-id="sessionId" :active-session="activeSession" :session-count="sessions.length" :status-text="statusText" />
    </section>
    <Transition name="splash"><div v-if="!appReady" class="fixed inset-0 z-[500] grid place-items-center bg-[var(--rg-terminal)]">
      <div class="grid justify-items-center gap-3 font-mono"><span class="text-2xl font-bold tracking-[0.4em]">SPECCAT</span><span>starting terminal...</span></div>
    </div></Transition>
    <Teleport to="body">
      <AppToastStack :toasts="toasts" :theme-vars="themeVars" @dismiss="dismissToast" />
      <NewSessionModal ref="newSessionBaseBranchRef" v-model:base-branch="newSessionBaseBranch" v-model:provider="newSessionProvider"
        :open="showNewSessionModal" :pending-action="pendingFeatureAction" :pending-action-label="pendingFeatureActionLabel"
        :session-options="sessionOptions" :loading="loadingSessionOptions" :creating="creatingSession"
        :error="integrationError" :theme-vars="themeVars" @create="createNewSession" @close="showNewSessionModal = false" />
      <SettingsModal ref="settingsDoneRef" v-model:provider="defaultProvider" :open="showSettingsModal"
        :provider-options="settingsProviderOptions" :app-version="appVersion" :theme-vars="themeVars" @close="showSettingsModal = false" />
      <GitDialogModal :dialog="gitDialog" :theme-vars="themeVars" @confirm="confirmGitDialog" @cancel="cancelGitDialog" />
      <IntegrationModal ref="integrationBaseBranchRef" v-model:base-branch="integrationBaseBranch"
        v-model:commit-message="integrationCommitMessage" :open="showIntegrationModal" :mode="integrationMode"
        :active-session="activeSession" :session-options="sessionOptions" :running="integrationRunning"
        :error="integrationError" :preview-error="previewError" :generating-commit-message="generatingCommitMessage"
        :commit-query-screen="commitQueryScreen" :theme-vars="themeVars" @close="showIntegrationModal = false"
        @run="runSessionIntegration" @generate-commit-message="generateCommitMessage" />
      <ConflictReportModal ref="conflictCloseRef" :open="showConflictReport" :report="conflictReport"
        :theme-vars="themeVars" @close="showConflictReport = false" />
    </Teleport>
  </main>
</template>
<style scoped>
.splash-leave-active { transition: opacity 0.25s ease; }
.splash-leave-to { opacity: 0; }
</style>
