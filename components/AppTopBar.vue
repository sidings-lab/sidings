<script setup lang="ts">
import type { SessionListItem } from '~/types/session'

defineProps<{
  projectName: string
  activeSession: SessionListItem | undefined
  activeSidebarPanel: 'conversations' | 'terminal'
  databaseOpen: boolean
  chatMaximized: boolean
  mobile: boolean
}>()

defineEmits<{
  openChat: []
  openTerminal: []
  openDatabase: []
  toggleChatMaximized: []
  refresh: []
  openSettings: []
}>()
</script>

<template>
  <header class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[var(--rg-border)] bg-[var(--rg-sidebar)] px-3 text-[11px] text-[var(--rg-muted)]">
    <div class="flex min-w-0 items-center gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wider text-[var(--rg-accent)]">SIDINGS</span>
      <span class="truncate font-mono text-[11px]">/ {{ projectName || activeSession?.projectDir?.split('/').filter(Boolean).pop() || 'workspace' }}</span>
    </div>
    <div class="flex h-full min-w-0 items-center gap-0.5 font-mono text-[11px]">
      <button class="workspace-tab" :class="activeSidebarPanel === 'conversations' && !databaseOpen ? 'workspace-tab-active' : ''" title="Chat (⌘⌥1 / Ctrl+Alt+1)" @click="$emit('openChat')">Chat</button>
      <button class="workspace-tab" :class="activeSidebarPanel === 'terminal' && !databaseOpen ? 'workspace-tab-active' : ''" title="Terminal (⌘⌥2 or ⌘⌥T / Ctrl+Alt+2 or Ctrl+Alt+T)" @click="$emit('openTerminal')">Terminal</button>
      <button class="workspace-tab" :class="databaseOpen ? 'workspace-tab-active' : ''" title="Database (⌘⌥3 or ⌘⌥D / Ctrl+Alt+3 or Ctrl+Alt+D)" @click="$emit('openDatabase')">Database</button>
      <button v-if="!mobile" class="workspace-tab" :class="chatMaximized ? 'workspace-tab-active' : ''" title="Toggle maximized chat (⌘⌥L / Ctrl+Alt+L)" @click="$emit('toggleChatMaximized')">{{ chatMaximized ? '⤡' : '⤢' }}</button>
      <button class="ml-1 grid h-[22px] w-[22px] place-items-center rounded text-[13px] hover:bg-[var(--rg-editor)] hover:text-[var(--rg-foreground)]" title="Refresh" @click="$emit('refresh')">↻</button>
      <button class="grid h-[22px] w-[22px] place-items-center rounded text-[13px] hover:bg-[var(--rg-editor)] hover:text-[var(--rg-foreground)]" title="Settings" @click="$emit('openSettings')">⚙</button>
    </div>
  </header>
</template>
