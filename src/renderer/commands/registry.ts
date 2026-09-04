/**
 * The command registry.
 *
 * Everything the user can do has exactly one entry here. The command palette
 * lists them, the native menu sends their ids, and the keybinding table maps
 * chords to them -- so a menu item, a shortcut and a palette entry can never
 * disagree about what an action does.
 */

import { useEditors } from '../state/editors.js'
import { useGit } from '../state/git.js'
import { useSettings } from '../state/settings.js'
import { useUi } from '../state/ui.js'
import { useWorkspace } from '../state/workspace.js'
import { monaco } from '../monaco/setup.js'

export interface Command {
  id: string
  title: string
  category: string
  /** Human-readable shortcut, shown in the palette. */
  keybinding?: string
  run(): void | Promise<void>
  /** When false, the command is hidden from the palette and ignored. */
  enabled?(): boolean
}

/** The focused editor, for commands that act on it. */
let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  activeEditor = editor
}

export function getActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor
}

/** Run a built-in Monaco action against the focused editor. */
function editorAction(actionId: string): () => void {
  return () => {
    const editor = activeEditor
    if (!editor) return
    editor.focus()
    editor.getAction(actionId)?.run()
  }
}

const hasWorkspace = (): boolean => useWorkspace.getState().root !== null
const hasEditor = (): boolean => activeEditor !== null
const isRepo = (): boolean => useGit.getState().status.isRepo

export const COMMANDS: Command[] = [
  // ------------------------------------------------------------- file
  {
    id: 'workspace.open',
    title: 'Open Folder…',
    category: 'File',
    keybinding: 'Ctrl+K Ctrl+O',
    run: () => useWorkspace.getState().open()
  },
  {
    id: 'file.save',
    title: 'Save',
    category: 'File',
    keybinding: 'Ctrl+S',
    enabled: hasEditor,
    run: async () => {
      const { save } = useEditors.getState()
      try {
        // Format on save runs before the write so the formatted text is what
        // lands on disk, not a second edit after it.
        if (useSettings.getState().values['editor.formatOnSave']) {
          await activeEditor?.getAction('editor.action.formatDocument')?.run()
        }
        await save()
      } catch (err) {
        useUi.getState().notify((err as Error).message, 'error')
      }
    }
  },
  {
    id: 'file.saveAs',
    title: 'Save As…',
    category: 'File',
    keybinding: 'Ctrl+Shift+S',
    enabled: hasEditor,
    run: () => {
      const { active, activeGroup, saveAs } = useEditors.getState()
      const path = active[activeGroup]
      if (path) void saveAs(path)
    }
  },
  {
    id: 'file.saveAll',
    title: 'Save All',
    category: 'File',
    keybinding: 'Ctrl+Alt+S',
    run: () => useEditors.getState().saveAll()
  },
  {
    id: 'file.close',
    title: 'Close Editor',
    category: 'File',
    keybinding: 'Ctrl+W',
    enabled: hasEditor,
    run: () => {
      const { active, activeGroup, closeFile } = useEditors.getState()
      const path = active[activeGroup]
      if (path) void closeFile(path, activeGroup)
    }
  },
  {
    id: 'file.new',
    title: 'New File',
    category: 'File',
    keybinding: 'Ctrl+N',
    enabled: hasWorkspace,
    run: async () => {
      const root = useWorkspace.getState().root
      if (!root) return
      const name = window.prompt('New file name (relative to the workspace root):')
      if (!name) return
      const path = `${root}/${name}`
      try {
        await window.ide.fs.create(path, 'file')
        await useWorkspace.getState().refresh([path])
        await useEditors.getState().openFile(path)
      } catch (err) {
        useUi.getState().notify((err as Error).message, 'error')
      }
    }
  },

  // ------------------------------------------------------------- view
  {
    id: 'palette.open',
    title: 'Show All Commands',
    category: 'View',
    keybinding: 'Ctrl+Shift+P',
    run: () => useUi.getState().setOverlay('palette')
  },
  {
    id: 'quickopen.open',
    title: 'Go to File…',
    category: 'View',
    keybinding: 'Ctrl+P',
    enabled: hasWorkspace,
    run: () => useUi.getState().setOverlay('quickopen')
  },
  {
    id: 'view.explorer',
    title: 'Show Explorer',
    category: 'View',
    keybinding: 'Ctrl+Shift+E',
    run: () => useUi.getState().setSidebarView('explorer')
  },
  {
    // Owns Ctrl+Shift+F, and deliberately does not collapse the sidebar when
    // it is already showing Search -- asking to search again should always
    // leave the box on screen and focused.
    id: 'search.focus',
    title: 'Find in Files',
    category: 'View',
    keybinding: 'Ctrl+Shift+F',
    run: () => {
      useUi.getState().showSidebarView('search')
      // The panel mounts on the next frame; focus after it exists.
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>('[data-search-input]')
        input?.focus()
        input?.select()
      })
    }
  },
  {
    id: 'view.search',
    title: 'Show Search',
    category: 'View',
    run: () => useUi.getState().setSidebarView('search')
  },
  {
    id: 'view.git',
    title: 'Show Source Control',
    category: 'View',
    keybinding: 'Ctrl+Shift+G',
    run: () => {
      useUi.getState().setSidebarView('git')
      void useGit.getState().refresh()
    }
  },
  {
    id: 'view.toggleSidebar',
    title: 'Toggle Sidebar',
    category: 'View',
    keybinding: 'Ctrl+B',
    run: () => useUi.getState().toggleSidebar()
  },
  {
    id: 'terminal.toggle',
    title: 'Toggle Terminal',
    category: 'View',
    keybinding: 'Ctrl+`',
    enabled: hasWorkspace,
    run: () => {
      const ui = useUi.getState()
      if (ui.panelVisible && ui.panelTab === 'terminal') ui.togglePanel()
      else ui.setPanelTab('terminal')
    }
  },
  {
    id: 'problems.toggle',
    title: 'Toggle Problems',
    category: 'View',
    keybinding: 'Ctrl+Shift+M',
    run: () => {
      const ui = useUi.getState()
      if (ui.panelVisible && ui.panelTab === 'problems') ui.togglePanel()
      else ui.setPanelTab('problems')
    }
  },
  {
    id: 'editor.split',
    title: 'Split Editor',
    category: 'View',
    keybinding: 'Ctrl+\\',
    enabled: hasEditor,
    run: () => useEditors.getState().toggleSplit()
  },
  {
    id: 'view.toggleTheme',
    title: 'Toggle Light / Dark Theme',
    category: 'View',
    run: () => useSettings.getState().toggleTheme()
  },

  // ------------------------------------------------------------ editor
  {
    id: 'edit.find',
    title: 'Find',
    category: 'Edit',
    keybinding: 'Ctrl+F',
    enabled: hasEditor,
    run: editorAction('actions.find')
  },
  {
    id: 'edit.replace',
    title: 'Replace',
    category: 'Edit',
    keybinding: 'Ctrl+H',
    enabled: hasEditor,
    run: editorAction('editor.action.startFindReplaceAction')
  },
  {
    id: 'edit.format',
    title: 'Format Document',
    category: 'Edit',
    keybinding: 'Ctrl+Shift+I',
    enabled: hasEditor,
    run: editorAction('editor.action.formatDocument')
  },
  {
    id: 'edit.commentLine',
    title: 'Toggle Line Comment',
    category: 'Edit',
    keybinding: 'Ctrl+/',
    enabled: hasEditor,
    run: editorAction('editor.action.commentLine')
  },
  {
    id: 'edit.duplicateLine',
    title: 'Duplicate Line',
    category: 'Edit',
    keybinding: 'Ctrl+Shift+D',
    enabled: hasEditor,
    run: editorAction('editor.action.copyLinesDownAction')
  },
  {
    id: 'edit.moveLineUp',
    title: 'Move Line Up',
    category: 'Edit',
    keybinding: 'Alt+Up',
    enabled: hasEditor,
    run: editorAction('editor.action.moveLinesUpAction')
  },
  {
    id: 'edit.moveLineDown',
    title: 'Move Line Down',
    category: 'Edit',
    keybinding: 'Alt+Down',
    enabled: hasEditor,
    run: editorAction('editor.action.moveLinesDownAction')
  },
  {
    id: 'editor.gotoLine',
    title: 'Go to Line…',
    category: 'Go',
    keybinding: 'Ctrl+G',
    enabled: hasEditor,
    run: editorAction('editor.action.gotoLine')
  },
  {
    id: 'editor.gotoSymbol',
    title: 'Go to Symbol in Editor…',
    category: 'Go',
    keybinding: 'Ctrl+Shift+O',
    enabled: hasEditor,
    run: editorAction('editor.action.quickOutline')
  },

  // --------------------------------------------------------------- lsp
  {
    id: 'lsp.definition',
    title: 'Go to Definition',
    category: 'Go',
    keybinding: 'F12',
    enabled: hasEditor,
    run: editorAction('editor.action.revealDefinition')
  },
  {
    id: 'lsp.references',
    title: 'Find All References',
    category: 'Go',
    keybinding: 'Shift+F12',
    enabled: hasEditor,
    run: editorAction('editor.action.goToReferences')
  },
  {
    id: 'lsp.rename',
    title: 'Rename Symbol',
    category: 'Refactor',
    keybinding: 'F2',
    enabled: hasEditor,
    run: editorAction('editor.action.rename')
  },
  {
    id: 'lsp.quickFix',
    title: 'Quick Fix…',
    category: 'Refactor',
    keybinding: 'Ctrl+.',
    enabled: hasEditor,
    run: editorAction('editor.action.quickFix')
  },
  {
    id: 'problems.next',
    title: 'Go to Next Problem',
    category: 'Go',
    keybinding: 'F8',
    enabled: hasEditor,
    run: editorAction('editor.action.marker.next')
  },
  {
    id: 'problems.previous',
    title: 'Go to Previous Problem',
    category: 'Go',
    keybinding: 'Shift+F8',
    enabled: hasEditor,
    run: editorAction('editor.action.marker.prev')
  },

  // --------------------------------------------------------------- git
  {
    id: 'git.commit',
    title: 'Commit',
    category: 'Git',
    enabled: isRepo,
    run: () => useGit.getState().commit()
  },
  {
    id: 'git.stageAll',
    title: 'Stage All Changes',
    category: 'Git',
    enabled: isRepo,
    run: () => {
      const paths = useGit
        .getState()
        .status.changes.filter((c) => !c.staged)
        .map((c) => c.path)
      void useGit.getState().stage(paths)
    }
  },
  {
    id: 'git.unstageAll',
    title: 'Unstage All Changes',
    category: 'Git',
    enabled: isRepo,
    run: () => {
      const paths = useGit
        .getState()
        .status.changes.filter((c) => c.staged)
        .map((c) => c.path)
      void useGit.getState().unstage(paths)
    }
  },
  {
    id: 'git.stash',
    title: 'Stash Changes',
    category: 'Git',
    enabled: isRepo,
    run: () => useGit.getState().stash('push')
  },
  {
    id: 'git.stashPop',
    title: 'Pop Latest Stash',
    category: 'Git',
    enabled: isRepo,
    run: () => useGit.getState().stash('pop')
  },
  {
    id: 'git.branches',
    title: 'Checkout Branch…',
    category: 'Git',
    enabled: isRepo,
    run: () => {
      void useGit.getState().refreshBranches()
      useUi.getState().setOverlay('branches')
    }
  },
  {
    id: 'git.refresh',
    title: 'Refresh Source Control',
    category: 'Git',
    enabled: isRepo,
    run: () => useGit.getState().refresh()
  },

  // ---------------------------------------------------------- settings
  {
    id: 'settings.open',
    title: 'Open Settings (JSON)',
    category: 'Preferences',
    keybinding: 'Ctrl+,',
    run: async () => {
      const path = await window.ide.settings.path()
      try {
        await useEditors.getState().openFile(path)
      } catch {
        useUi
          .getState()
          .notify('Settings file does not exist yet. Change a setting to create it.', 'error')
      }
    }
  },
  {
    id: 'help.shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'Help',
    run: () => useUi.getState().setOverlay('palette')
  },
  {
    id: 'help.about',
    title: 'About',
    category: 'Help',
    run: () => useUi.getState().setOverlay('about')
  }
]

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function runCommand(id: string): void {
  const command = BY_ID.get(id)
  if (!command) return
  if (command.enabled && !command.enabled()) return
  void command.run()
}

export function availableCommands(): Command[] {
  return COMMANDS.filter((c) => !c.enabled || c.enabled())
}
