/**
 * Application shell and the wiring between main-process events and stores.
 *
 * All the cross-cutting subscriptions live here in one effect each, so there
 * is a single place to look for "what happens when the main process says X".
 */

import { useEffect, useRef } from 'react'
import { installKeybindings } from './commands/keybindings.js'
import { runCommand } from './commands/registry.js'
import { DialogHost } from './components/common/Dialog.js'
import { ActivityBar } from './components/layout/ActivityBar.js'
import { Panel } from './components/layout/Panel.js'
import { Sidebar } from './components/layout/Sidebar.js'
import { StatusBar } from './components/layout/StatusBar.js'
import { EditorArea } from './components/editor/EditorArea.js'
import { Overlays } from './components/palette/Overlays.js'
import { applyDiagnostics, registerLspProviders, watchMarkers } from './monaco/lsp-bridge.js'
import { setupMonaco } from './monaco/setup.js'
import { useEditors } from './state/editors.js'
import { useGit } from './state/git.js'
import { useLsp } from './state/lsp.js'
import { useSearch } from './state/search.js'
import { useSettings } from './state/settings.js'
import { useUi } from './state/ui.js'
import { useWorkspace } from './state/workspace.js'

export function App(): React.ReactElement {
  useBootstrap()
  useMainProcessEvents()
  useSessionPersistence()

  return (
    <div className="app">
      <ActivityBar />
      <div className="app__main">
        <Sidebar />
        <div className="app__editor-column">
          <EditorArea />
          <Panel />
        </div>
      </div>
      <StatusBar />
      <Overlays />
      <DialogHost />
    </div>
  )
}

/** One-time setup: Monaco, providers, settings, keybindings, session restore. */
function useBootstrap(): void {
  useEffect(() => {
    setupMonaco()
    registerLspProviders()
    const markerSubscription = watchMarkers()

    void useSettings.getState().load()
    const uninstall = installKeybindings()

    // Restore the previous workspace and its open files.
    void (async () => {
      const session = await window.ide.session.get()
      if (!session.workspaceRoot) return

      try {
        await useWorkspace.getState().open(session.workspaceRoot)
      } catch {
        // The folder was moved or deleted since the last run.
        return
      }

      for (const path of session.openFiles) {
        // A file may have been deleted while the app was closed; skip it
        // rather than failing the whole restore.
        await useEditors.getState().openFile(path, 'primary').catch(() => undefined)
      }
      if (session.activeFile) {
        useEditors.getState().setActive(session.activeFile, 'primary')
      }

      await useGit.getState().refresh()
      useLsp.getState().setServers(await window.ide.lsp.status())
    })()

    return () => {
      uninstall()
      markerSubscription.dispose()
    }
  }, [])
}

/** Subscriptions to push channels from the main process. */
function useMainProcessEvents(): void {
  useEffect(() => {
    const unsubscribers = [
      window.ide.menu.onCommand((commandId) => {
        // 'workspace.restore' is sent by the main process on load; the
        // bootstrap effect already handles restoring, so ignore it here.
        if (commandId === 'workspace.restore') return
        runCommand(commandId)
      }),

      window.ide.workspace.onFileEvents((events) => {
        const paths = events.map((event) => event.path)
        void useWorkspace.getState().refresh(paths)

        // Files created or deleted outside the tree -- by a terminal command,
        // a formatter, a branch switch -- must reach quick-open too.
        useWorkspace.getState().scheduleIndexRefresh()

        // A change under .git means the working tree status may have moved.
        void useGit.getState().refresh()

        // Reload an open, unmodified file that changed on disk -- typical when
        // switching branches or running a formatter in the terminal.
        const { files, reloadFromDisk } = useEditors.getState()
        for (const path of paths) {
          const file = files.get(path)
          if (file && !file.dirty) void reloadFromDisk(path).catch(() => undefined)
        }
      }),

      window.ide.lsp.onDiagnostics((path, diagnostics) => {
        applyDiagnostics(path, diagnostics)
      }),

      window.ide.lsp.onStatusChanged((servers) => {
        useLsp.getState().setServers(servers)
      }),

      window.ide.git.onChanged(() => {
        void useGit.getState().refresh()
      }),

      window.ide.search.onResults((searchId, results) => {
        useSearch.getState().appendResults(searchId, results)
      }),

      window.ide.search.onDone((searchId, summary) => {
        useSearch.getState().finish(searchId, summary)
      })
    ]

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])
}

/**
 * Persist the session so a restart comes back to the same place.
 *
 * Debounced, because tab and workspace changes come in bursts and this writes
 * a file each time.
 */
function useSessionPersistence(): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const save = (): void => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const editors = useEditors.getState()
        void window.ide.session.set({
          workspaceRoot: useWorkspace.getState().root,
          openFiles: editors.groups.primary,
          activeFile: editors.active.primary,
          secondGroupFiles: editors.groups.secondary,
          secondGroupActive: editors.active.secondary
        })
      }, 500)
    }

    const unsubscribers = [useEditors.subscribe(save), useWorkspace.subscribe(save)]
    return () => {
      if (timer.current) clearTimeout(timer.current)
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])
}

// Keep the UI store imported for its side effect of being created eagerly,
// so the first render does not construct it mid-tree.
void useUi
