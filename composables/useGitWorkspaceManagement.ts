import type { Ref } from 'vue'
import type { GitDialogOptions, GitRemoteDetail, ToastType, WorktreeItem } from '~/types/app'
import type { GitActionId } from '~/types/git-actions'
import { extractFetchError } from '~/utils/fetch-error'

type Dialog = (options: GitDialogOptions) => Promise<Record<string, string | boolean> | null>
type RunAction = (action: GitActionId, payload?: Record<string, unknown>) => Promise<boolean>
type PushToast = (type: ToastType, message: string, duration?: number) => void

export function useGitWorkspaceManagement(options: {
  cwd: Ref<string>
  openDialog: Dialog
  runAction: RunAction
  pushToast: PushToast
  focusWorktreeCreate: () => void
  focusRemoteAdd: () => void
}) {
  const showRemotesModal = ref(false)
  const remotes = ref<GitRemoteDetail[]>([])
  const loadingRemotes = ref(false)
  const showWorktreesModal = ref(false)
  const worktrees = ref<WorktreeItem[]>([])
  const loadingWorktrees = ref(false)
  const worktreeActionRunning = ref(false)
  async function refreshWorktrees() {
    loadingWorktrees.value = true
    try {
      worktrees.value = (await $fetch<{ worktrees: WorktreeItem[] }>('/api/worktrees', { query: { cwd: options.cwd.value || undefined } })).worktrees
    } catch (error) { options.pushToast('error', `Failed to load worktrees: ${extractFetchError(error)}`, 6000) }
    finally { loadingWorktrees.value = false }
  }
  async function openWorktreesModal() {
    showWorktreesModal.value = true
    await nextTick(); options.focusWorktreeCreate(); await refreshWorktrees()
  }
  async function createWorktree() {
    const result = await options.openDialog({ title: 'Create Worktree', message: 'The worktree is created under the managed Sidings state directory.', confirmLabel: 'Create', fields: [
      { kind: 'text', key: 'branch', label: 'Branch (created if missing)', value: '', placeholder: 'sc/experiment' },
      { kind: 'text', key: 'baseRef', label: 'Base ref (for a new branch)', value: 'HEAD' }
    ] })
    if (!result?.branch || worktreeActionRunning.value) return
    worktreeActionRunning.value = true
    try {
      await $fetch('/api/worktrees', { method: 'POST', body: { cwd: options.cwd.value || undefined, branch: result.branch, baseRef: result.baseRef || undefined } })
      options.pushToast('success', `Worktree for ${result.branch} created.`); await refreshWorktrees()
    } catch (error) { options.pushToast('error', `Failed to create worktree: ${extractFetchError(error)}`, 6000) }
    finally { worktreeActionRunning.value = false }
  }
  async function removeWorktree(worktree: WorktreeItem) {
    if (worktreeActionRunning.value) return
    const name = worktree.path.split('/').pop() || ''
    const result = await options.openDialog({ title: 'Remove Worktree', message: `Remove worktree ${name} (${worktree.branch || 'detached'})?`, danger: true, confirmLabel: 'Remove', fields: [{ kind: 'checkbox', key: 'deleteBranch', label: 'Also delete the branch', value: false }] })
    if (!result) return
    worktreeActionRunning.value = true
    try {
      const url: string = `/api/worktrees/${encodeURIComponent(name)}`
      await $fetch(url, { method: 'DELETE', query: { cwd: options.cwd.value || undefined, deleteBranch: result.deleteBranch ? 'true' : undefined } })
      options.pushToast('success', `Worktree ${name} removed.`); await refreshWorktrees()
    } catch (error) { options.pushToast('error', `Failed to remove worktree: ${extractFetchError(error)}`, 6000) }
    finally { worktreeActionRunning.value = false }
  }
  async function refreshRemotes() {
    loadingRemotes.value = true
    try { remotes.value = (await $fetch<{ remotes: GitRemoteDetail[] }>('/api/git/remotes', { query: { cwd: options.cwd.value || undefined } })).remotes }
    catch (error) { options.pushToast('error', `Failed to load remotes: ${extractFetchError(error)}`, 6000) }
    finally { loadingRemotes.value = false }
  }
  async function openRemotesModal() { showRemotesModal.value = true; await nextTick(); options.focusRemoteAdd(); await refreshRemotes() }
  async function addRemote() {
    const result = await options.openDialog({ title: 'Add Remote', confirmLabel: 'Add', fields: [
      { kind: 'text', key: 'remote', label: 'Remote name', value: '', placeholder: 'origin' },
      { kind: 'text', key: 'url', label: 'URL', value: '', placeholder: 'git@github.com:user/repo.git' }
    ] })
    if (result?.remote && result.url && await options.runAction('addRemote', { remote: result.remote, url: result.url })) await refreshRemotes()
  }
  async function editRemote(remote: GitRemoteDetail) {
    const result = await options.openDialog({ title: 'Edit Remote', message: `Change the URL of ${remote.name}.`, confirmLabel: 'Save', fields: [{ kind: 'text', key: 'url', label: 'URL', value: remote.fetchUrl }] })
    if (result?.url && result.url !== remote.fetchUrl && await options.runAction('editRemote', { remote: remote.name, url: result.url })) await refreshRemotes()
  }
  async function removeRemote(remote: GitRemoteDetail) {
    const result = await options.openDialog({ title: 'Delete Remote', message: `Delete remote ${remote.name} (${remote.fetchUrl})?`, danger: true, confirmLabel: 'Delete' })
    if (result && await options.runAction('deleteRemote', { remote: remote.name })) await refreshRemotes()
  }
  return { showRemotesModal, remotes, loadingRemotes, showWorktreesModal, worktrees,
    loadingWorktrees, worktreeActionRunning,
    refreshWorktrees, openWorktreesModal, createWorktree, removeWorktree,
    refreshRemotes, openRemotesModal, addRemote, editRemote, removeRemote }
}
