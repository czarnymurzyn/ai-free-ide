/**
 * Settings, session and app-info handlers.
 */

import { app, ipcMain } from 'electron'
import { CH, type AppInfo } from '../../shared/ipc-contract.js'
import type { Settings } from '../../shared/types.js'
import {
  getSettings,
  getSettingsPath,
  getSession,
  invalidateSettingsCache,
  setSession,
  updateSettings
} from '../store.js'
import { invalidateDiscovery } from './lsp.js'

export function registerSettingsHandlers(): void {
  ipcMain.handle(CH.settingsGet, () => getSettings())

  ipcMain.handle(CH.settingsSet, async (_e, partial: Partial<Settings>) => {
    const next = await updateSettings(partial)
    // Changing a server path must invalidate the cached PATH probe, or the
    // override silently does nothing until restart.
    if ('lsp.serverPaths' in partial) invalidateDiscovery()
    return next
  })

  ipcMain.handle(CH.settingsPath, () => getSettingsPath())

  ipcMain.handle(CH.sessionGet, () => getSession())
  ipcMain.handle(CH.sessionSet, (_e, state) => setSession(state))

  ipcMain.handle(
    CH.appInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      offline: true
    })
  )
}

/**
 * Called when the watcher sees settings.json change on disk, so an edit made
 * in the IDE's own editor takes effect on save.
 */
export function reloadSettingsFromDisk(): void {
  invalidateSettingsCache()
  invalidateDiscovery()
}
