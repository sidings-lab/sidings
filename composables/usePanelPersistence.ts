import type { Ref } from 'vue'

// Keep these local-storage keys stable so upgrades retain the user's layout.
const SIDEBAR_PANEL_KEY = 'code-cat-sidebar-panel'
const SIDEBAR_COLLAPSED_KEY = 'code-cat-sidebar-collapsed'
const SPEC_PANEL_COLLAPSED_KEY = 'code-cat-spec-panel-collapsed'
const ACTIVE_SHELL_KEY = 'code-cat-active-shell'

export function usePanelPersistence(options: {
  activeSidebarPanel: Ref<'conversations' | 'terminal'>
  sidebarCollapsed: Ref<boolean>
  specPanelCollapsed: Ref<boolean>
  activeShellId: Ref<string>
}) {
  onBeforeMount(() => {
    const storedPanel = window.localStorage.getItem(SIDEBAR_PANEL_KEY)
    if (storedPanel === 'conversations' || storedPanel === 'terminal') {
      options.activeSidebarPanel.value = storedPanel
    }
    const shellId = window.localStorage.getItem(ACTIVE_SHELL_KEY)
    if (shellId) options.activeShellId.value = shellId
    options.sidebarCollapsed.value = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    options.specPanelCollapsed.value = window.localStorage.getItem(SPEC_PANEL_COLLAPSED_KEY) === '1'
  })

  watch(options.activeSidebarPanel, (panel) => window.localStorage.setItem(SIDEBAR_PANEL_KEY, panel))
  watch(options.sidebarCollapsed, (collapsed) => window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'))
  watch(options.specPanelCollapsed, (collapsed) => window.localStorage.setItem(SPEC_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0'))
  watch(options.activeShellId, (id) => {
    if (id) window.localStorage.setItem(ACTIVE_SHELL_KEY, id)
    else window.localStorage.removeItem(ACTIVE_SHELL_KEY)
  })
}
