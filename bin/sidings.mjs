#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `sidings - Git-native workbench for autonomous coding agents

Usage: sidings [options]

Options:
  -p, --port <port>     Port to listen on (default: 3000)
  -H, --host <host>     Host to bind (default: 127.0.0.1)
      --project <dir>   Project directory to operate on
                        (sets SPEC_CAT_PROJECT_DIR)
      --no-open         Do not open Sidings in the default browser
  -h, --help            Show this help message
`

function fail(message) {
  console.error(`sidings: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { port: 3000, host: '127.0.0.1', project: undefined, open: true }

  const takeValue = (flag, inlineValue, next) => {
    if (inlineValue !== undefined) return inlineValue.value
    const value = next()
    if (value === undefined) fail(`missing value for ${flag}`)
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    let flag = arg
    let inlineValue
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq !== -1) {
      flag = arg.slice(0, eq)
      inlineValue = { value: arg.slice(eq + 1) }
    }

    switch (flag) {
      case '-h':
      case '--help':
        console.log(HELP)
        process.exit(0)
        break
      case '-p':
      case '--port': {
        const raw = takeValue(flag, inlineValue, next)
        const port = Number(raw)
        if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`invalid port: ${raw}`)
        options.port = port
        break
      }
      case '-H':
      case '--host':
        options.host = takeValue(flag, inlineValue, next)
        break
      case '--project':
        options.project = takeValue(flag, inlineValue, next)
        break
      case '--no-open':
        options.open = false
        break
      default:
        fail(`unknown option: ${arg}\n\n${HELP}`)
    }
  }

  return options
}

function launchBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function openBrowserWhenReady(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        launchBrowser(url)
        return
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  console.error(`sidings: server started, but ${url} did not become ready in time; open it manually`)
}

const options = parseArgs(process.argv.slice(2))

if (options.project !== undefined) {
  const projectDir = resolve(process.cwd(), options.project)
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    fail(`project directory does not exist: ${projectDir}`)
  }
  // Keep the legacy variable stable so existing installations retain their state.
  process.env.SPEC_CAT_PROJECT_DIR = projectDir
}

process.env.NITRO_PORT = String(options.port)
process.env.PORT = String(options.port)
process.env.NITRO_HOST = options.host
process.env.HOST = options.host

const serverEntry = resolve(packageRoot, '.output/server/index.mjs')
if (!existsSync(serverEntry)) {
  fail(`built server not found at ${serverEntry}\nBuild the project first (run: pnpm build)`)
}

const browserHost = ['0.0.0.0', '::', '[::]'].includes(options.host) ? '127.0.0.1' : options.host
const browserUrl = `http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${options.port}`
if (options.open && !process.env.CI && process.env.SIDINGS_NO_OPEN !== '1') {
  void openBrowserWhenReady(browserUrl)
}

await import(pathToFileURL(serverEntry).href)
