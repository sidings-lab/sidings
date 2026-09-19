import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun'
const require = createRequire(import.meta.url)

await run(bunCommand, ['run', 'build:nuxt'])
copyNodePtyNativeAssets()

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit'
    })

    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(
        new Error(`${command} ${args.join(' ')} failed with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`)
      )
    })
  })
}

function copyNodePtyNativeAssets() {
  const sourceRoot = dirname(require.resolve('node-pty/package.json'))
  const outputRoots = [
    resolve(rootDir, '.output/server/node_modules/@homebridge/node-pty-prebuilt-multiarch'),
    resolve(rootDir, '.output/server/node_modules/node-pty')
  ]

  const prebuildsSource = resolve(sourceRoot, 'prebuilds')
  const thirdPartySource = resolve(sourceRoot, 'third_party')

  let copied = false
  for (const outputRoot of outputRoots) {
    if (!existsSync(outputRoot)) {
      mkdirSync(outputRoot, { recursive: true })
    }

    for (const item of ['package.json', 'lib']) {
      const itemSrc = resolve(sourceRoot, item)
      const itemDest = resolve(outputRoot, item)
      if (existsSync(itemSrc) && !existsSync(itemDest)) {
        cpSync(itemSrc, itemDest, { recursive: true, force: true })
      }
    }

    if (existsSync(prebuildsSource)) {
      const destination = resolve(outputRoot, 'prebuilds')
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(prebuildsSource, destination, { recursive: true, force: true })
      copied = true
    }

    if (existsSync(thirdPartySource)) {
      const destination = resolve(outputRoot, 'third_party')
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(thirdPartySource, destination, { recursive: true, force: true })
    }
  }

  if (!copied) {
    throw new Error(`Could not find node-pty native assets in ${sourceRoot}`)
  }
}

