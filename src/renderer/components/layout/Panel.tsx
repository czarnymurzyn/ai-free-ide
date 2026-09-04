/**
 * The bottom panel: terminal and problems.
 *
 * The terminal is mounted once and hidden with CSS rather than unmounted when
 * another tab is selected -- unmounting would dispose the xterm instance and
 * kill the scrollback.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CloseIcon, ErrorIcon, InfoIcon, WarningIcon } from '../Icons.js'
import { TerminalView } from '../terminal/TerminalView.js'
import { getActiveEditor } from '../../commands/registry.js'
import { useEditors } from '../../state/editors.js'
import { buildProblems, useLsp } from '../../state/lsp.js'
import { useUi, type PanelTab } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './Panel.css'

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'problems', label: 'Problems' }
]

export function Panel(): React.ReactElement | null {
  const { panelVisible, panelTab, panelHeight, setPanelTab, togglePanel, setPanelHeight } = useUi()
  const problemCount = useLsp((s) => {
    let n = 0
    for (const markers of s.diagnostics.values()) n += markers.length
    return n
  })
  const dragging = useRef(false)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return
      // Height grows upward from the status bar.
      setPanelHeight(window.innerHeight - event.clientY - 24)
    }
    const onUp = (): void => {
      dragging.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [setPanelHeight])

  if (!panelVisible) return null

  return (
    <div className="panel" style={{ height: panelHeight }}>
      <div
        className="panel__resizer"
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
      />

      <div className="panel__header">
        <div className="panel__tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={panelTab === tab.id}
              className={`panel__tab${panelTab === tab.id ? ' panel__tab--active' : ''}`}
              onClick={() => setPanelTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'problems' && problemCount > 0 && (
                <span className="panel__tab-count">{problemCount}</span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="panel__close"
          onClick={togglePanel}
          title="Close panel"
          aria-label="Close panel"
        >
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="panel__body">
        <div className="panel__pane" hidden={panelTab !== 'terminal'}>
          <TerminalView />
        </div>
        {panelTab === 'problems' && <ProblemsList />}
      </div>
    </div>
  )
}

function ProblemsList(): React.ReactElement {
  // Select the map (a stable reference) and derive the list here; selecting
  // a freshly-built array would re-render forever. See buildProblems.
  const diagnostics = useLsp((s) => s.diagnostics)
  const problems = useMemo(() => buildProblems(diagnostics), [diagnostics])
  const openFile = useEditors((s) => s.openFile)
  const root = useWorkspace((s) => s.root)

  if (problems.length === 0) {
    return <p className="panel__empty">No problems have been detected in the open files.</p>
  }

  return (
    <div className="problems">
      {problems.map((problem, index) => {
        const { marker, path } = problem
        const Icon =
          marker.severity === 8 ? ErrorIcon : marker.severity === 4 ? WarningIcon : InfoIcon
        const severity =
          marker.severity === 8 ? 'error' : marker.severity === 4 ? 'warning' : 'info'
        const relative = root && path.startsWith(root) ? path.slice(root.length + 1) : path

        return (
          <button
            key={`${path}:${marker.startLineNumber}:${marker.startColumn}:${index}`}
            type="button"
            className="problems__row"
            onClick={async () => {
              await openFile(path)
              requestAnimationFrame(() => {
                const editor = getActiveEditor()
                editor?.revealLineInCenter(marker.startLineNumber)
                editor?.setPosition({
                  lineNumber: marker.startLineNumber,
                  column: marker.startColumn
                })
                editor?.focus()
              })
            }}
          >
            <span className={`problems__icon problems__icon--${severity}`}>
              <Icon size={13} />
            </span>
            <span className="problems__message truncate">{marker.message}</span>
            <span className="problems__source">{marker.source}</span>
            <span className="problems__location truncate">
              {relative}:{marker.startLineNumber}:{marker.startColumn}
            </span>
          </button>
        )
      })}
    </div>
  )
}
