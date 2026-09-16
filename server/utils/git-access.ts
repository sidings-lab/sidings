import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { projectDir as configuredProjectDir, projectWorktreeRoot } from './project-dir'

export async function requireAllowedGitCwd(value: unknown) {
  const requested = typeof value === 'string' && value.trim() ? value.trim() : configuredProjectDir()
  if (!isAbsolute(requested)) throw new Error('Git working directory must be an absolute path')

  const target = await realpath(resolve(requested))
  const project = await realpath(configuredProjectDir())
  const worktreeRoot = projectWorktreeRoot()
  const managedRoot = await realpath(worktreeRoot).catch(() => resolve(worktreeRoot))

  if (isWithin(target, project) || isManagedWorktree(target, managedRoot)) return target
  throw new Error('Git working directory is outside the configured project and managed worktrees')
}

/**
 * Canonical (symlink-resolved) root of the project this server instance is
 * scoped to. Used to keep each `sidings` invocation's session list isolated to
 * the directory it was launched from.
 */
export async function getConfiguredProjectRoot(): Promise<string> {
  try {
    return await realpath(configuredProjectDir())
  } catch {
    return configuredProjectDir()
  }
}

function isWithin(target: string, root: string) {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isManagedWorktree(target: string, root: string) {
  if (!isWithin(target, root)) return false
  const [directory] = relative(root, target).split(/[\\/]/)
  return /^sc-[a-zA-Z0-9_-]{8,120}$/.test(directory || '')
}

export function requireRef(value: unknown, name: string) {
  const ref = requireArgument(value, name)
  if (!/^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\\s])(?!.+\/$)(?!.*\/\/)[A-Za-z0-9._/@{}+-]+$/.test(ref)) {
    throw new Error(`Invalid ${name}`)
  }
  return ref
}

export function requireObjectName(value: unknown, name: string) {
  const object = requireArgument(value, name)
  if (!/^(?!-)[A-Za-z0-9][A-Za-z0-9._/@{}+~^-]*$/.test(object) || object.includes('..')) {
    throw new Error(`Invalid ${name}`)
  }
  return object
}

export function requireRemote(value: unknown, name = 'remote') {
  const remote = requireArgument(value, name)
  if (!/^(?!-)[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error(`Invalid ${name}`)
  return remote
}

export function requireRemoteUrl(value: unknown, name = 'url') {
  const url = requireArgument(value, name)
  if (url.startsWith('-') || url.length > 2048 || /[\0\r\n]/.test(url)) {
    throw new Error(`Invalid ${name}`)
  }
  return url
}

function requireArgument(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}
