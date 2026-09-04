/**
 * The open workspace, and the path jail around it.
 *
 * The renderer names files by absolute path. Since the renderer is the least
 * trusted part of this app, every path it sends is re-resolved here and
 * checked against the workspace root before any syscall touches it. That stops
 * a traversal bug in the UI (or a malicious file name) from reading or writing
 * outside the folder the user actually opened.
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

let workspaceRoot: string | null = null

export function getWorkspaceRoot(): string | null {
  return workspaceRoot
}

/**
 * Set the active workspace. Resolves symlinks so that the jail comparison
 * below is done on real paths and cannot be defeated by a symlinked root.
 */
export async function setWorkspaceRoot(dir: string): Promise<string> {
  const resolved = await realpath(resolve(dir))
  const info = await stat(resolved)
  if (!info.isDirectory()) throw new Error(`Not a directory: ${dir}`)
  workspaceRoot = resolved
  return resolved
}

export function clearWorkspaceRoot(): void {
  workspaceRoot = null
}

export class PathJailError extends Error {
  constructor(readonly attempted: string) {
    super(`Refused to access a path outside the workspace: ${attempted}`)
    this.name = 'PathJailError'
  }
}

/**
 * Pure containment check, exported for tests.
 *
 * Uses path.relative rather than a string prefix test: a prefix test would
 * accept `/home/user/project-secrets` for the root `/home/user/project`.
 */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (rel.startsWith('..' + sep) || rel === '..') return false
  return !isAbsolute(rel)
}

/**
 * Validate a path from the renderer and return its resolved form.
 *
 * Note this resolves `..` segments *before* comparing, so `/root/a/../../etc`
 * is rejected rather than accepted on its literal spelling.
 */
export function assertInsideWorkspace(target: string): string {
  const root = workspaceRoot
  if (!root) throw new Error('No workspace is open')
  const resolved = resolve(root, target)
  if (!isInside(root, resolved)) throw new PathJailError(target)
  return resolved
}

/**
 * The same check, but following symlinks first -- for reads and writes of
 * files that already exist. A symlink inside the workspace pointing at
 * /etc/shadow would pass the lexical check above but fail this one.
 *
 * Falls back to the lexical check when the path does not exist yet (creating
 * a new file), where there is nothing to resolve.
 */
export async function assertInsideWorkspaceReal(target: string): Promise<string> {
  const lexical = assertInsideWorkspace(target)
  const root = workspaceRoot
  if (!root) throw new Error('No workspace is open')
  try {
    const real = await realpath(lexical)
    if (!isInside(root, real)) throw new PathJailError(target)
    return real
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return lexical
    throw err
  }
}

/** Workspace-relative path for display, falling back to the absolute path. */
export function toRelative(target: string): string {
  const root = workspaceRoot
  if (!root) return target
  const rel = relative(root, target)
  return rel === '' || rel.startsWith('..') ? target : rel
}
