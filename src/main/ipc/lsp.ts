/**
 * Language-server supervisor.
 *
 * Owns the set of running servers, routes document events and requests to the
 * right one, and reports status to the UI. A file's server is chosen by its
 * language id; a language with no installed server simply has no intelligence,
 * which the status bar shows plainly rather than nagging about.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { CH, EV } from '../../shared/ipc-contract.js'
import { languageIdFor } from '../../shared/languages.js'
import type { LanguageServerState, LanguageServerStatus } from '../../shared/types.js'
import { discoverServers, type DiscoveredServer } from '../lsp/discovery.js'
import { specsForLanguage } from '../lsp/registry.js'
import { LanguageServer } from '../lsp/server.js'
import { getSettings } from '../store.js'
import { getWorkspaceRoot } from '../workspace/root.js'

const servers = new Map<string, LanguageServer>()
const states = new Map<string, { state: LanguageServerState; detail?: string }>()
let discovered: DiscoveredServer[] = []

export function registerLspHandlers(getWindow: () => BrowserWindow | null): void {
  const broadcastStatus = (): void => {
    void buildStatus().then((status) => {
      getWindow()?.webContents.send(EV.lspStatusChanged, status)
    })
  }

  const events = {
    onDiagnostics(path: string, diagnostics: unknown[]): void {
      getWindow()?.webContents.send(EV.lspDiagnostics, path, diagnostics)
    },
    onStateChange(id: string, state: LanguageServerState, detail?: string): void {
      states.set(id, { state, ...(detail ? { detail } : {}) })
      broadcastStatus()
    }
  }

  ipcMain.handle(CH.lspStatus, async () => {
    await refreshDiscovery()
    return buildStatus()
  })

  ipcMain.handle(
    CH.lspDidOpen,
    async (_e, path: string, languageId: string, version: number, text: string) => {
      const server = await serverFor(languageId, events)
      if (!server) return
      try {
        await server.didOpen(path, languageId, version, text)
      } catch (err) {
        events.onStateChange(server.id, 'failed', (err as Error).message)
      }
    }
  )

  ipcMain.handle(CH.lspDidChange, async (_e, path: string, version: number, text: string) => {
    const server = servers.get(serverIdForPath(path) ?? '')
    await server?.didChange(path, version, text)
  })

  ipcMain.handle(CH.lspDidSave, async (_e, path: string, text: string) => {
    const server = servers.get(serverIdForPath(path) ?? '')
    await server?.didSave(path, text)
  })

  ipcMain.handle(CH.lspDidClose, async (_e, path: string) => {
    const server = servers.get(serverIdForPath(path) ?? '')
    await server?.didClose(path)
  })

  ipcMain.handle(CH.lspRequest, async (_e, path: string, method: string, params: unknown) => {
    const id = serverIdForPath(path)
    if (!id) return null
    const server = servers.get(id)
    if (!server) return null
    try {
      return await server.request(method, params)
    } catch (err) {
      // A server that does not implement a method answers with an error; the
      // editor should degrade quietly rather than surface a dialog.
      const message = (err as Error).message ?? ''
      if (/method not found|unhandled method/i.test(message)) return null
      throw err
    }
  })

  ipcMain.handle(CH.lspRestart, async (_e, serverId: string) => {
    const existing = servers.get(serverId)
    if (existing) {
      await existing.dispose()
      servers.delete(serverId)
    }
    states.delete(serverId)
    await refreshDiscovery()
    broadcastStatus()
  })
}

/** Which server id currently owns a given file, if any. */
function serverIdForPath(path: string): string | null {
  for (const [id, server] of servers) {
    if (server.hasOpenDocument(path)) return id
  }
  // Not opened yet: fall back to the language mapping.
  const languageId = languageIdFor(path)
  for (const spec of specsForLanguage(languageId)) {
    if (servers.has(spec.id)) return spec.id
  }
  return null
}

async function serverFor(
  languageId: string,
  events: ConstructorParameters<typeof LanguageServer>[3]
): Promise<LanguageServer | null> {
  const root = getWorkspaceRoot()
  if (!root) return null

  await refreshDiscovery()

  for (const spec of specsForLanguage(languageId)) {
    const existing = servers.get(spec.id)
    if (existing) return existing

    const found = discovered.find((d) => d.spec.id === spec.id)
    if (!found) continue

    const server = new LanguageServer(found.spec, found.binary, root, events)
    servers.set(spec.id, server)
    return server
  }
  return null
}

let discoveryPromise: Promise<void> | null = null

async function refreshDiscovery(): Promise<void> {
  if (discoveryPromise) return discoveryPromise
  discoveryPromise = (async () => {
    const settings = await getSettings()
    discovered = await discoverServers(settings['lsp.serverPaths'])
  })()
  return discoveryPromise
}

/** Drop the cached probe so a newly installed server is picked up. */
export function invalidateDiscovery(): void {
  discoveryPromise = null
}

async function buildStatus(): Promise<LanguageServerStatus[]> {
  await refreshDiscovery()
  return discovered.map(({ spec, binary }) => {
    const runtime = states.get(spec.id)
    return {
      id: spec.id,
      label: spec.label,
      languages: spec.languages,
      state: runtime?.state ?? 'inactive',
      binary,
      ...(runtime?.detail ? { detail: runtime.detail } : {})
    }
  })
}

export async function disposeAllServers(): Promise<void> {
  await Promise.all([...servers.values()].map((s) => s.dispose()))
  servers.clear()
  states.clear()
}
