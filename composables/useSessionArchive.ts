import type { Ref } from 'vue'
import type { SessionListItem } from '~/types/session'
import type { GitDialogField, ToastType } from '~/types/app'
import { shortId } from '~/utils/app-formatters'
import { extractFetchError } from '~/utils/fetch-error'

type PushToast = (type: ToastType, message: string, duration?: number) => void
type OpenDialog = (options: { title: string; message?: string; confirmLabel?: string; danger?: boolean; fields?: GitDialogField[] }) => Promise<Record<string, string | boolean> | null>

export function useSessionArchive(options: {
  sessions: Ref<SessionListItem[]>
  sessionId: Ref<string>
  clearSessionId: () => void
  selectedArchivedSessionId: Ref<string>
  refreshSessions: () => Promise<void>
  selectSession: (id: string) => void
  connect: (id: string) => void
  closeTerminal: () => void
  resetTerminal: (cursorBlink?: boolean) => void
  writelnTerminal: (value: string) => void
  openDialog: OpenDialog
  pushToast: PushToast
}) {
  const archivedSessions = ref<SessionListItem[]>([])
  const loadingArchived = ref(false)
  const showArchivedSessions = ref(false)
  const archivingSessionId = ref('')
  const restoringSessionId = ref('')
  const deletingSessionId = ref('')
  const editingSessionId = ref('')
  const editingSessionTitle = ref('')
  const savingSessionTitle = ref(false)
  const sessionDisplayName = (session: SessionListItem) => session.title || shortId(session.id)
  function startSessionRename(session: SessionListItem) { editingSessionId.value = session.id; editingSessionTitle.value = session.title || '' }
  function cancelSessionRename() { editingSessionId.value = ''; editingSessionTitle.value = '' }
  async function saveSessionRename() {
    const id = editingSessionId.value
    if (!id || savingSessionTitle.value) return
    savingSessionTitle.value = true
    try {
      const url: string = `/api/sessions/${encodeURIComponent(id)}`
      await $fetch(url, { method: 'PATCH', body: { title: editingSessionTitle.value.trim() } })
      cancelSessionRename()
      await options.refreshSessions()
    } catch (error) { options.pushToast('error', `Failed to rename conversation: ${extractFetchError(error)}`, 6000) }
    finally { savingSessionTitle.value = false }
  }
  async function refreshArchivedSessions() {
    loadingArchived.value = true
    try { archivedSessions.value = (await $fetch<{ sessions: SessionListItem[] }>('/api/sessions/archives')).sessions }
    catch (error) { console.warn('Failed to refresh archived conversations', error) }
    finally { loadingArchived.value = false }
  }
  async function toggleArchivedSessions() {
    showArchivedSessions.value = !showArchivedSessions.value
    if (showArchivedSessions.value) await refreshArchivedSessions()
  }
  async function archiveSession(session: SessionListItem) {
    if (archivingSessionId.value) return
    const confirmed = await options.openDialog({ title: 'Archive Conversation', message: `Archive ${sessionDisplayName(session)}?\nThe tmux session and worktree are removed. The branch is kept, so the conversation can be restored later.`, confirmLabel: 'Archive' })
    if (!confirmed) return
    archivingSessionId.value = session.id
    const active = session.id === options.sessionId.value
    try {
      const url: string = `/api/sessions/${encodeURIComponent(session.id)}/archive`
      await $fetch(url, { method: 'POST' })
      if (active) {
        options.closeTerminal()
        options.clearSessionId()
        options.resetTerminal()
        options.writelnTerminal('Conversation archived.\r\n')
      }
      await Promise.allSettled([options.refreshSessions(), refreshArchivedSessions()])
      options.pushToast('success', 'Conversation archived.')
      if (active && options.sessions.value[0]) options.selectSession(options.sessions.value[0].id)
    } catch (error) { options.pushToast('error', `Failed to archive conversation: ${extractFetchError(error)}`, 6000) }
    finally { archivingSessionId.value = '' }
  }
  async function restoreArchivedSession(session: SessionListItem) {
    if (restoringSessionId.value) return
    restoringSessionId.value = session.id
    try {
      const url: string = `/api/sessions/archives/${encodeURIComponent(session.id)}/restore`
      await $fetch(url, { method: 'POST' })
      await Promise.allSettled([options.refreshSessions(), refreshArchivedSessions()])
      options.pushToast('success', 'Conversation restored.')
      options.selectedArchivedSessionId.value = ''
      options.selectSession(session.id)
    } catch (error) { options.pushToast('error', `Failed to restore conversation: ${extractFetchError(error)}`, 6000) }
    finally { restoringSessionId.value = '' }
  }
  async function deleteArchivedSession(session: SessionListItem) {
    if (deletingSessionId.value) return
    const confirmed = await options.openDialog({ title: 'Delete Archived Conversation', message: `Permanently delete ${sessionDisplayName(session)}?\nIts kept branch and logs are removed. This cannot be undone.`, danger: true, confirmLabel: 'Delete' })
    if (!confirmed) return
    deletingSessionId.value = session.id
    try {
      const url: string = `/api/sessions/archives/${encodeURIComponent(session.id)}`
      await $fetch(url, { method: 'DELETE' })
      await refreshArchivedSessions()
      if (options.selectedArchivedSessionId.value === session.id) { options.selectedArchivedSessionId.value = ''; options.resetTerminal(true) }
      options.pushToast('success', 'Archived conversation deleted.')
    } catch (error) { options.pushToast('error', `Failed to delete archived conversation: ${extractFetchError(error)}`, 6000) }
    finally { deletingSessionId.value = '' }
  }
  async function deleteAllArchivedSessions() {
    if (deletingSessionId.value || !archivedSessions.value.length) return
    const confirmed = await options.openDialog({ title: 'Delete All Archived Conversations', message: `Permanently delete all ${archivedSessions.value.length} archived conversations? This cannot be undone.`, danger: true, confirmLabel: 'Delete All' })
    if (!confirmed) return
    deletingSessionId.value = 'all'
    try {
      await $fetch('/api/sessions/archives', { method: 'DELETE' })
      await refreshArchivedSessions()
      if (options.selectedArchivedSessionId.value) { options.selectedArchivedSessionId.value = ''; options.resetTerminal(true) }
      options.pushToast('success', 'All archived conversations deleted.')
    } catch (error) { options.pushToast('error', `Failed to delete archived conversations: ${extractFetchError(error)}`, 6000) }
    finally { deletingSessionId.value = '' }
  }
  return { archivedSessions, loadingArchived, showArchivedSessions, archivingSessionId,
    restoringSessionId, deletingSessionId, editingSessionId, editingSessionTitle,
    savingSessionTitle, sessionDisplayName, startSessionRename, cancelSessionRename,
    saveSessionRename, refreshArchivedSessions, toggleArchivedSessions, archiveSession,
    restoreArchivedSession, deleteArchivedSession, deleteAllArchivedSessions }
}
