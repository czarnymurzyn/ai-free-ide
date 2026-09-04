/**
 * Locate language servers already installed on this machine.
 *
 * PATH is walked directly rather than shelling out to `which`, which keeps the
 * probe fast (no process per candidate) and avoids depending on a shell.
 */

import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import type { LanguageServerSpec } from '../../shared/types.js'
import { SERVER_SPECS } from './registry.js'

/**
 * Resolve a command to an absolute path, or null when it is not installed.
 *
 * An absolute or relative path (as set in `lsp.serverPaths`) is checked
 * directly; a bare name is looked up across PATH.
 */
export async function resolveBinary(command: string): Promise<string | null> {
  if (command.includes('/')) {
    return (await isExecutable(command)) ? command : null
  }

  const pathVar = process.env.PATH ?? ''
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    const candidate = isAbsolute(dir) ? join(dir, command) : join(process.cwd(), dir, command)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() && !info.isSymbolicLink()) return false
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface DiscoveredServer {
  spec: LanguageServerSpec
  binary: string
}

/**
 * Probe every known server once.
 *
 * @param overrides Explicit binary paths from settings, keyed by server id.
 *                  An override is used even if the name is not on PATH.
 */
export async function discoverServers(
  overrides: Record<string, string> = {}
): Promise<DiscoveredServer[]> {
  const results = await Promise.all(
    SERVER_SPECS.map(async (spec) => {
      const command = overrides[spec.id] ?? spec.command
      const binary = await resolveBinary(command)
      return binary ? { spec, binary } : null
    })
  )
  return results.filter((r): r is DiscoveredServer => r !== null)
}
