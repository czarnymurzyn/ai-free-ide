/**
 * Native application menu.
 *
 * Menu items do not act directly; they send a command id to the renderer,
 * which runs it through the same command registry the palette and keybindings
 * use. One code path per command means a menu item and its shortcut can never
 * drift apart.
 *
 * Note what is absent: no Help > Check for Updates, no Report Issue, no
 * documentation links. Every one of those would be a network request.
 */

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { EV } from '../shared/ipc-contract.js'

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (commandId: string) => () => {
    getWindow()?.webContents.send(EV.menuCommand, commandId)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: send('file.new') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+K CmdOrCtrl+O', click: send('workspace.open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file.save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('file.saveAs') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Alt+S', click: send('file.saveAll') },
        { type: 'separator' },
        { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: send('file.close') },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: send('settings.open') },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: send('edit.find') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: send('edit.replace') },
        { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: send('search.focus') }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: send('palette.open') },
        { label: 'Go to File…', accelerator: 'CmdOrCtrl+P', click: send('quickopen.open') },
        { type: 'separator' },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: send('view.explorer') },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: send('view.search') },
        { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: send('view.git') },
        { type: 'separator' },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+`', click: send('terminal.toggle') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send('view.toggleSidebar') },
        { label: 'Split Editor', accelerator: 'CmdOrCtrl+\\', click: send('editor.split') },
        { type: 'separator' },
        { label: 'Toggle Theme', click: send('view.toggleTheme') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : ([{ role: 'toggleDevTools' }, { role: 'reload' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: '&Go',
      submenu: [
        { label: 'Go to Definition', accelerator: 'F12', click: send('lsp.definition') },
        { label: 'Find All References', accelerator: 'Shift+F12', click: send('lsp.references') },
        { label: 'Rename Symbol', accelerator: 'F2', click: send('lsp.rename') },
        { type: 'separator' },
        { label: 'Go to Line…', accelerator: 'CmdOrCtrl+G', click: send('editor.gotoLine') },
        { label: 'Go to Symbol…', accelerator: 'CmdOrCtrl+Shift+O', click: send('editor.gotoSymbol') },
        { type: 'separator' },
        { label: 'Next Problem', accelerator: 'F8', click: send('problems.next') },
        { label: 'Previous Problem', accelerator: 'Shift+F8', click: send('problems.previous') }
      ]
    },
    {
      label: 'G&it',
      submenu: [
        { label: 'Commit…', accelerator: 'CmdOrCtrl+Enter', click: send('git.commit') },
        { label: 'Stage All Changes', click: send('git.stageAll') },
        { label: 'Unstage All Changes', click: send('git.unstageAll') },
        { type: 'separator' },
        { label: 'Stash Changes', click: send('git.stash') },
        { label: 'Pop Stash', click: send('git.stashPop') },
        { type: 'separator' },
        { label: 'Refresh', click: send('git.refresh') }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: send('help.shortcuts') },
        { label: 'About', click: send('help.about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
