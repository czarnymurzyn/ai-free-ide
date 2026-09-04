/**
 * Main process entry point.
 *
 * Order matters here: the Chromium networking switches must be appended before
 * the app is ready, and the offline guard must be installed on the session
 * before any window loads content. Both happen before anything else.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerFsHandlers } from './ipc/fs.js'
import { registerGitHandlers } from './ipc/git.js'
import { disposeAllServers, registerLspHandlers } from './ipc/lsp.js'
import { disposeAllPtys, registerPtyHandlers } from './ipc/pty.js'
import { registerSearchHandlers } from './ipc/search.js'
import { registerSettingsHandlers } from './ipc/settings.js'
import { buildMenu } from './menu.js'
import { applyNetworkCommandLineSwitches, hardenWebContents, installOfflineGuard } from './offline.js'
import { getSession } from './store.js'
import { stopWatching } from './workspace/watcher.js'

// ---- before app ready -----------------------------------------------------

applyNetworkCommandLineSwitches()

// Native Wayland where the compositor supports it (COSMIC, GNOME, KDE), with
// an automatic fall back to XWayland. Without the hint Electron picks X11 and
// renders blurrily on fractional-scaling displays.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')

let mainWindow: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => mainWindow

// One window is enough; a second instance should focus the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

app.whenReady().then(async () => {
  installOfflineGuard(undefined, (blocked) => {
    // Visible in the terminal the IDE was launched from. Nothing is reported
    // anywhere else -- there is nowhere to report it to.
    console.warn(`[offline] blocked ${blocked.scheme} request: ${blocked.url}`)
  })

  registerFsHandlers(getWindow)
  registerPtyHandlers(getWindow)
  registerSearchHandlers(getWindow)
  registerGitHandlers(getWindow)
  registerLspHandlers(getWindow)
  registerSettingsHandlers()

  buildMenu(getWindow)
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

async function createWindow(): Promise<void> {
  const session = await getSession()

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 680,
    minHeight: 480,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#1b1d23',
    title: 'AI-Free IDE',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer gets no Node access whatsoever. Everything it can do to
      // the machine goes through the audited IPC surface in shared/ipc-contract.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // No remote content is ever loaded, so there is nothing to isolate into
      // a separate site instance, but leaving these on costs nothing.
      webviewTag: false,
      spellcheck: false
    }
  })

  hardenWebContents(mainWindow.webContents)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // In development electron-vite serves the renderer over loopback http; the
  // packaged app always loads from disk.
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Restore the previous workspace, if it still exists.
  if (session.workspaceRoot) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('ide:menu:command', 'workspace.restore')
    })
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  disposeAllPtys()
  stopWatching()
  void disposeAllServers()
})

// Catches any WebContents created outside createWindow -- a devtools window,
// or anything a future feature adds -- so none of them can navigate outward.
app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents)
})
