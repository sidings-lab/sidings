import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(rootDir, '.output')
const serverEntry = resolve(outputDir, 'server/index.mjs')
const publicDir = resolve(outputDir, 'public')
const nodePtyRoot = resolve(outputDir, 'server/node_modules/node-pty')
const BOOT_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250
const staticOnly = process.argv.includes('--static')

const passed = []

function ok(message) {
  passed.push(message)
  console.log(`ok - ${message}`)
}

function fail(message) {
  console.error(`\nFAIL - ${message}`)
  process.exit(1)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function getFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.unref()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

// --- 1. Static asset checks -------------------------------------------------

if (!existsSync(serverEntry)) {
  fail(`missing built server entry: ${serverEntry}\nRun the build first: bun run build`)
}
ok('.output/server/index.mjs exists')

if (!existsSync(publicDir) || !statSync(publicDir).isDirectory()) {
  fail(`missing built public assets: ${publicDir}\nRun the build first: bun run build`)
}
ok('.output/public exists')

// Mirrors the copy targets in scripts/build-package.mjs.
const nativeCandidates = [
  'build',
  `prebuilds/${process.platform}-${process.arch}`
]
const nativeFound = nativeCandidates
  .map((candidate) => resolve(nodePtyRoot, candidate))
  .filter((candidate) => existsSync(candidate))

if (nativeFound.length === 0) {
  fail(
    `no node-pty native assets found under ${nodePtyRoot}\n` +
    `expected at least one of: ${nativeCandidates.join(', ')}\n` +
    'Run the build first: bun run build'
  )
}
for (const found of nativeFound) {
  ok(`node-pty native assets present: ${found}`)
}

if (staticOnly) {
  console.log(`\nStatic build verification passed (${passed.length} checks):`)
  for (const message of passed) console.log(`  - ${message}`)
  process.exit(0)
}

// --- 2. Smoke-boot the built server ----------------------------------------

const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const sessionDir = mkdtempSync(join(tmpdir(), 'code-cat-verify-'))

const child = spawn(process.execPath, [serverEntry], {
  cwd: rootDir,
  env: {
    ...process.env,
    NITRO_PORT: String(port),
    PORT: String(port),
    NITRO_HOST: '127.0.0.1',
    HOST: '127.0.0.1',
    // Point session storage at a throwaway dir so verification never
    // touches real session data under ~/.sidings.
    SIDINGS_V2_DIR: sessionDir
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let childOutput = ''
let childExited = false
child.stdout.on('data', (chunk) => { childOutput += chunk })
child.stderr.on('data', (chunk) => { childOutput += chunk })
child.on('exit', () => { childExited = true })

async function stopChild() {
  if (childExited) return
  child.kill('SIGTERM')
  const deadline = Date.now() + 3_000
  while (!childExited && Date.now() < deadline) {
    await sleep(100)
  }
  if (!childExited) {
    child.kill('SIGKILL')
  }
}

function cleanup() {
  rmSync(sessionDir, { recursive: true, force: true })
}

async function failBoot(message) {
  await stopChild()
  cleanup()
  const output = childOutput.trim()
  fail(`${message}${output ? `\n--- server output ---\n${output}` : ''}`)
}

try {
  const deadline = Date.now() + BOOT_TIMEOUT_MS

  // Poll / until it serves HTML.
  let htmlOk = false
  while (Date.now() < deadline) {
    if (childExited) {
      await failBoot(`server exited early with code ${child.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/`)
      const body = await response.text()
      if (response.status === 200 && /<(!doctype|html)/i.test(body)) {
        htmlOk = true
        break
      }
    } catch {
      // Not accepting connections yet; keep polling.
    }
    await sleep(POLL_INTERVAL_MS)
  }
  if (!htmlOk) {
    await failBoot(`GET / did not return HTML (status 200) within ${BOOT_TIMEOUT_MS / 1000}s on ${baseUrl}`)
  }
  ok(`GET / returned 200 with HTML on ${baseUrl}`)

  // Check /api/settings returns JSON.
  let settingsOk = false
  let settingsDetail = ''
  try {
    const response = await fetch(`${baseUrl}/api/settings`)
    const body = await response.text()
    if (response.status === 200) {
      JSON.parse(body)
      settingsOk = true
    } else {
      settingsDetail = `status ${response.status}: ${body.slice(0, 300)}`
    }
  } catch (error) {
    settingsDetail = String(error)
  }
  if (!settingsOk) {
    await failBoot(`GET /api/settings did not return JSON (${settingsDetail})`)
  }
  ok('GET /api/settings returned 200 with valid JSON')
} finally {
  await stopChild()
  cleanup()
}

console.log(`\nBuild verification passed (${passed.length} checks):`)
for (const message of passed) {
  console.log(`  - ${message}`)
}
process.exit(0)
