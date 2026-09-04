import { useEffect, useState } from 'react'
import { ErrorIcon, GitIcon, OfflineIcon, WarningIcon } from '../Icons.js'
import { useEditors } from '../../state/editors.js'
import { useGit } from '../../state/git.js'
import { useLsp } from '../../state/lsp.js'
import { useUi } from '../../state/ui.js'
import { runCommand } from '../../commands/registry.js'
import { getActiveEditor } from '../../commands/registry.js'
import './StatusBar.css'

export function StatusBar(): React.ReactElement {
  const { files, active, activeGroup } = useEditors()
  const gitStatus = useGit((s) => s.status)
  const servers = useLsp((s) => s.servers)
  const diagnostics = useLsp((s) => s.diagnostics)
  const notice = useUi((s) => s.notice)

  const activePath = active[activeGroup]
  const file = activePath ? files.get(activePath) : undefined
  const cursor = useCursorPosition(activePath)

  // Recomputed from the map rather than stored, so it cannot drift.
  let errors = 0
  let warnings = 0
  for (const markers of diagnostics.values()) {
    for (const marker of markers) {
      if (marker.severity === 8) errors++
      else if (marker.severity === 4) warnings++
    }
  }

  const activeServer = servers.find(
    (s) => s.state === 'running' && file && s.languages.includes(file.languageId)
  )

  return (
    <footer className="status-bar app__status">
      <div className="status-bar__group">
        {gitStatus.isRepo && (
          <button
            type="button"
            className="status-bar__item"
            onClick={() => runCommand('git.branches')}
            title="Checkout branch (local branches only)"
          >
            <GitIcon size={13} />
            <span>{gitStatus.detached ? 'detached HEAD' : (gitStatus.branch ?? '—')}</span>
            {gitStatus.changes.length > 0 && <span>{gitStatus.changes.length}∆</span>}
          </button>
        )}

        <button
          type="button"
          className="status-bar__item"
          onClick={() => runCommand('problems.toggle')}
          title="Problems (Ctrl+Shift+M)"
        >
          <ErrorIcon size={13} />
          <span>{errors}</span>
          <WarningIcon size={13} />
          <span>{warnings}</span>
        </button>
      </div>

      <div className="status-bar__spacer">
        {notice && (
          <span
            className={`status-bar__notice${notice.kind === 'error' ? ' status-bar__notice--error' : ''}`}
          >
            {notice.text}
          </span>
        )}
      </div>

      <div className="status-bar__group">
        {file && (
          <>
            <span className="status-bar__item status-bar__item--static">
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <span className="status-bar__item status-bar__item--static">
              {file.eol === '\r\n' ? 'CRLF' : 'LF'}
            </span>
            <span className="status-bar__item status-bar__item--static">{file.languageId}</span>
          </>
        )}

        <span
          className="status-bar__item status-bar__item--static"
          title={
            activeServer
              ? `${activeServer.label} — ${activeServer.binary}`
              : 'No language server is running for this file type'
          }
        >
          {activeServer ? activeServer.label : 'No language server'}
        </span>

        {/*
          The permanent reminder of what this app is. It is not a toggle:
          there is nothing to turn on.
        */}
        <span
          className="status-bar__item status-bar__item--offline"
          title="This IDE makes no network connections and contains no AI features."
        >
          <OfflineIcon size={13} />
          <span>Offline</span>
        </span>
      </div>
    </footer>
  )
}

/**
 * Track the caret in the focused editor.
 *
 * Subscribing here rather than storing the position in a store keeps a
 * cursor move from re-rendering anything but this one component.
 */
function useCursorPosition(activePath: string | null): { line: number; column: number } {
  const [position, setPosition] = useState({ line: 1, column: 1 })

  useEffect(() => {
    const editor = getActiveEditor()
    if (!editor) {
      setPosition({ line: 1, column: 1 })
      return
    }

    const initial = editor.getPosition()
    if (initial) setPosition({ line: initial.lineNumber, column: initial.column })

    const subscription = editor.onDidChangeCursorPosition((event) => {
      setPosition({ line: event.position.lineNumber, column: event.position.column })
    })
    return () => subscription.dispose()
  }, [activePath])

  return position
}
