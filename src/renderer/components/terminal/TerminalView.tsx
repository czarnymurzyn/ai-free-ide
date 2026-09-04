/**
 * Integrated terminal.
 *
 * Each tab owns an xterm instance bound to a PTY in the main process. The
 * xterm object is kept in a module-level map rather than React state so that
 * hiding the panel does not destroy the shell -- the user's running `npm run
 * dev` survives a Ctrl+` toggle.
 */

import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { CloseIcon, PlusIcon } from '../Icons.js'
import { useSettings } from '../../state/settings.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './TerminalView.css'

interface Instance {
  id: string
  title: string
  term: Terminal
  fit: FitAddon
  /** Buffered writes that arrived before the element was attached. */
  pending: string[]
  attached: boolean
}

/** Live terminals, keyed by PTY session id. */
const instances = new Map<string, Instance>()

/** Subscriptions are installed once for the whole app, not per component. */
let listenersInstalled = false
const listeners = new Set<() => void>()

function notifyChange(): void {
  for (const listener of listeners) listener()
}

function installGlobalListeners(): void {
  if (listenersInstalled) return
  listenersInstalled = true

  window.ide.pty.onData((id, data) => {
    const instance = instances.get(id)
    if (!instance) return
    if (instance.attached) instance.term.write(data)
    else instance.pending.push(data)
  })

  window.ide.pty.onExit((id) => {
    const instance = instances.get(id)
    if (!instance) return
    instance.term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')
    instances.delete(id)
    notifyChange()
  })
}

export function TerminalView(): React.ReactElement {
  const root = useWorkspace((s) => s.root)
  const fontSize = useSettings((s) => s.values['terminal.fontSize'])
  const fontFamily = useSettings((s) => s.values['editor.fontFamily'])
  const theme = useSettings((s) => s.values['workbench.theme'])
  const notify = useUi((s) => s.notify)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [, forceUpdate] = useState(0)
  const host = useRef<HTMLDivElement>(null)

  // Re-render this component whenever the shared instance map changes.
  useEffect(() => {
    const listener = (): void => forceUpdate((n) => n + 1)
    listeners.add(listener)
    installGlobalListeners()
    return () => {
      listeners.delete(listener)
    }
  }, [])

  // Create the first terminal on demand.
  useEffect(() => {
    if (!root || instances.size > 0) return
    void createTerminal(root, { fontSize, fontFamily, theme }, setActiveId, notify)
  }, [root, fontSize, fontFamily, theme, notify])

  // Select something if the active terminal exited.
  useEffect(() => {
    if (activeId && instances.has(activeId)) return
    const first = instances.keys().next()
    setActiveId(first.done ? null : first.value)
  }, [activeId])

  // Attach the active terminal to the DOM and size it to the container.
  useEffect(() => {
    const container = host.current
    if (!container || !activeId) return

    const instance = instances.get(activeId)
    if (!instance) return

    container.replaceChildren()
    instance.term.open(container)

    if (!instance.attached) {
      instance.attached = true
      for (const chunk of instance.pending) instance.term.write(chunk)
      instance.pending = []
    }

    // The container has no size until after layout; fit on the next frame.
    const raf = requestAnimationFrame(() => {
      try {
        instance.fit.fit()
        void window.ide.pty.resize(instance.id, instance.term.cols, instance.term.rows)
        instance.term.focus()
      } catch {
        /* the panel is hidden or zero-sized */
      }
    })

    const observer = new ResizeObserver(() => {
      try {
        instance.fit.fit()
        void window.ide.pty.resize(instance.id, instance.term.cols, instance.term.rows)
      } catch {
        /* ignore transient zero sizes */
      }
    })
    observer.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [activeId])

  // Apply theme and font changes to every live terminal.
  useEffect(() => {
    for (const instance of instances.values()) {
      instance.term.options.fontSize = fontSize
      instance.term.options.fontFamily = fontFamily
      instance.term.options.theme = xtermTheme(theme)
    }
  }, [fontSize, fontFamily, theme])

  const list = [...instances.values()]

  return (
    <div className="terminal-view">
      <div className="terminal-view__tabs">
        {list.map((instance, index) => (
          <button
            key={instance.id}
            type="button"
            className={`terminal-view__tab${activeId === instance.id ? ' terminal-view__tab--active' : ''}`}
            onClick={() => setActiveId(instance.id)}
          >
            <span className="truncate">
              {index + 1}: {instance.title}
            </span>
            <span
              role="button"
              tabIndex={-1}
              aria-label="Kill terminal"
              className="terminal-view__kill"
              onClick={(event) => {
                event.stopPropagation()
                void window.ide.pty.kill(instance.id)
                instance.term.dispose()
                instances.delete(instance.id)
                notifyChange()
              }}
            >
              <CloseIcon size={11} />
            </span>
          </button>
        ))}

        <button
          type="button"
          className="terminal-view__add"
          title="New terminal"
          aria-label="New terminal"
          onClick={() => {
            if (root) void createTerminal(root, { fontSize, fontFamily, theme }, setActiveId, notify)
          }}
        >
          <PlusIcon size={14} />
        </button>
      </div>

      <div ref={host} className="terminal-instance" />
    </div>
  )
}

async function createTerminal(
  cwd: string,
  style: { fontSize: number; fontFamily: string; theme: 'ide-dark' | 'ide-light' },
  setActiveId: (id: string) => void,
  notify: (text: string, kind?: 'info' | 'error') => void
): Promise<void> {
  const term = new Terminal({
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    theme: xtermTheme(style.theme),
    cursorBlink: true,
    scrollback: 10_000,
    allowProposedApi: true,
    // The renderer must not open links; there is nothing to open them with.
    linkHandler: { activate: () => undefined, hover: () => undefined, leave: () => undefined }
  })

  const fit = new FitAddon()
  term.loadAddon(fit)

  try {
    const session = await window.ide.pty.spawn({
      cwd,
      cols: term.cols || 80,
      rows: term.rows || 24
    })

    const instance: Instance = {
      id: session.id,
      title: session.shell.split('/').pop() ?? 'shell',
      term,
      fit,
      pending: [],
      attached: false
    }
    instances.set(session.id, instance)

    term.onData((data) => {
      void window.ide.pty.write(session.id, data)
    })

    term.onResize(({ cols, rows }) => {
      void window.ide.pty.resize(session.id, cols, rows)
    })

    setActiveId(session.id)
    notifyChange()
  } catch (err) {
    term.dispose()
    notify(`Could not start a terminal: ${(err as Error).message}`, 'error')
  }
}

/** xterm needs literal colours; these mirror the CSS custom properties. */
function xtermTheme(theme: 'ide-dark' | 'ide-light'): Record<string, string> {
  if (theme === 'ide-light') {
    return {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#0a66d0',
      selectionBackground: '#cfe0f7',
      black: '#1f2328', red: '#c62d28', green: '#1a7f5a', yellow: '#9a6a00',
      blue: '#0a58ca', magenta: '#8250df', cyan: '#0d7490', white: '#d6d9e0',
      brightBlack: '#6b7280', brightRed: '#e0524d', brightGreen: '#25a06f',
      brightYellow: '#b8860b', brightBlue: '#3b82f6', brightMagenta: '#a855f7',
      brightCyan: '#0ea5b7', brightWhite: '#1f2328'
    }
  }
  return {
    background: '#16181d',
    foreground: '#dce1e8',
    cursor: '#4d9fff',
    selectionBackground: '#2b3a52',
    black: '#3d4552', red: '#f0625d', green: '#4ec9a5', yellow: '#e2b341',
    blue: '#6cb6ff', magenta: '#c98fdb', cyan: '#5ec9d8', white: '#dce1e8',
    brightBlack: '#6b7484', brightRed: '#ff7b76', brightGreen: '#6fdcb9',
    brightYellow: '#f0c65e', brightBlue: '#8cc6ff', brightMagenta: '#dba8ea',
    brightCyan: '#7fdae7', brightWhite: '#ffffff'
  }
}
