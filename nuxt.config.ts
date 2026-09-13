import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version?: string }

export default defineNuxtConfig({
  ssr: false,
  app: {
    head: {
      title: 'Sidings — Git-native agent workbench',
      meta: [
        { name: 'description', content: 'Run coding agents in isolated Git worktrees from a local web dashboard.' }
      ]
    }
  },
  compatibilityDate: '2026-07-08',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      appVersion: pkg.version || '0.0.0'
    }
  },
  vite: {
    plugins: [tailwindcss()]
  },
  nitro: {
    experimental: {
      websocket: true,
      openAPI: true
    }
  }
})
