/**
 * The overlay layer: whichever quick-pick or dialog is currently open.
 */

import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc-contract.js'
import { availableCommands, runCommand } from '../../commands/registry.js'
import { useEditors } from '../../state/editors.js'
import { useGit } from '../../state/git.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import { QuickPick, type QuickPickItem } from './QuickPick.js'
import './Overlays.css'

export function Overlays(): React.ReactElement | null {
  const overlay = useUi((s) => s.overlay)
  const setOverlay = useUi((s) => s.setOverlay)
  const dismiss = (): void => setOverlay('none')

  switch (overlay) {
    case 'palette':
      return <CommandPalette onDismiss={dismiss} />
    case 'quickopen':
      return <QuickOpen onDismiss={dismiss} />
    case 'branches':
      return <BranchPicker onDismiss={dismiss} />
    case 'about':
      return <About onDismiss={dismiss} />
    default:
      return null
  }
}

function CommandPalette({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const items: QuickPickItem[] = availableCommands().map((command) => ({
    id: command.id,
    label: `${command.category}: ${command.title}`,
    ...(command.keybinding ? { detail: command.keybinding } : {})
  }))

  return (
    <QuickPick
      items={items}
      placeholder="Type a command"
      onDismiss={onDismiss}
      onAccept={(item) => {
        onDismiss()
        runCommand(item.id)
      }}
    />
  )
}

function QuickOpen({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const { root, fileIndex, refreshIndex } = useWorkspace()
  const openFile = useEditors((s) => s.openFile)
  const notify = useUi((s) => s.notify)

  // The index can be stale if files changed since it was built.
  useEffect(() => {
    if (fileIndex.length === 0) void refreshIndex()
  }, [fileIndex.length, refreshIndex])

  const items: QuickPickItem[] = fileIndex.map((relative) => {
    const slash = relative.lastIndexOf('/')
    return {
      id: relative,
      label: slash === -1 ? relative : relative.slice(slash + 1),
      ...(slash === -1 ? {} : { description: relative.slice(0, slash) })
    }
  })

  return (
    <QuickPick
      items={items}
      placeholder="Go to file"
      onDismiss={onDismiss}
      onAccept={(item) => {
        onDismiss()
        if (!root) return
        openFile(`${root}/${item.id}`).catch((err: Error) => notify(err.message, 'error'))
      }}
    />
  )
}

function BranchPicker({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const { branches, checkout, createBranch } = useGit()

  const items: QuickPickItem[] = [
    { id: '__create__', label: '＋ Create new branch…', detail: '' },
    ...branches.map((branch) => ({
      id: branch.name,
      label: branch.name,
      detail: branch.head,
      ...(branch.current ? { description: 'current' } : {})
    }))
  ]

  return (
    <QuickPick
      items={items}
      placeholder="Checkout a local branch"
      onDismiss={onDismiss}
      onAccept={(item) => {
        onDismiss()
        if (item.id === '__create__') {
          const name = window.prompt('New branch name:')
          if (name) void createBranch(name.trim())
          return
        }
        void checkout(item.id)
      }}
    />
  )
}

function About({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.ide.app.info().then(setInfo)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div className="quick-pick__backdrop" onMouseDown={onDismiss}>
      <div
        className="about"
        role="dialog"
        aria-modal="true"
        aria-label="About"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="about__title">AI-Free IDE</h2>
        <p className="about__tagline">
          A code editor that makes no network connections and contains no AI features.
        </p>

        <dl className="about__facts">
          <dt>Version</dt>
          <dd>{info?.version ?? '…'}</dd>
          <dt>Electron</dt>
          <dd>{info?.electron ?? '…'}</dd>
          <dt>Chromium</dt>
          <dd>{info?.chrome ?? '…'}</dd>
          <dt>Node</dt>
          <dd>{info?.node ?? '…'}</dd>
          <dt>Platform</dt>
          <dd>{info?.platform ?? '…'}</dd>
        </dl>

        <ul className="about__guarantees">
          <li>Every non-local request is cancelled before it is sent.</li>
          <li>
            The content security policy sets <code>connect-src 'none'</code>.
          </li>
          <li>Git runs locally only — push, pull, fetch and clone are refused.</li>
          <li>Language servers are found on your PATH; nothing is downloaded.</li>
          <li>No telemetry, no auto-updater, no crash reporting, no marketplace.</li>
        </ul>

        <button type="button" className="about__close" onClick={onDismiss}>
          Close
        </button>
      </div>
    </div>
  )
}
