/**
 * The editor region: one or two groups, each with a tab strip, breadcrumbs and
 * either a text editor or a diff.
 */

import { useState } from 'react'
import { FileIcon } from '../FileIcon.js'
import { CloseIcon, SplitIcon } from '../Icons.js'
import { ContextMenu, useContextMenu, type MenuEntry } from '../common/ContextMenu.js'
import { useEditors, type GroupId } from '../../state/editors.js'
import { Breadcrumbs } from './Breadcrumbs.js'
import { DiffView } from './DiffView.js'
import './EditorArea.css'
import { MonacoHost } from './MonacoHost.js'

export function EditorArea(): React.ReactElement {
  const splitVisible = useEditors((s) => s.splitVisible)

  return (
    <div className="editor-area">
      <EditorGroup group="primary" />
      {splitVisible && (
        <>
          <div className="editor-area__divider" />
          <EditorGroup group="secondary" />
        </>
      )}
    </div>
  )
}

function EditorGroup({ group }: { group: GroupId }): React.ReactElement {
  const paths = useEditors((s) => s.groups[group])
  const active = useEditors((s) => s.active[group])
  const activeGroup = useEditors((s) => s.activeGroup)
  const files = useEditors((s) => s.files)
  const { setActive, closeFile, toggleSplit } = useEditors()

  const [menuTab, setMenuTab] = useState<string | null>(null)
  const menu = useContextMenu()

  const activeFile = active ? files.get(active) : undefined
  const showingDiff = activeFile?.kind === 'diff'

  const tabMenu = (tabId: string): MenuEntry[] => [
    { id: 'close', label: 'Close', hint: 'Ctrl+W', run: () => void closeFile(tabId, group) },
    {
      id: 'close-others',
      label: 'Close Others',
      disabled: paths.length < 2,
      run: () => {
        for (const other of paths.filter((p) => p !== tabId)) void closeFile(other, group)
      }
    },
    {
      id: 'close-right',
      label: 'Close to the Right',
      disabled: paths.indexOf(tabId) === paths.length - 1,
      run: () => {
        for (const other of paths.slice(paths.indexOf(tabId) + 1)) void closeFile(other, group)
      }
    },
    {
      id: 'close-all',
      label: 'Close All',
      run: () => {
        for (const other of [...paths]) void closeFile(other, group)
      }
    },
    { separator: true },
    {
      id: 'copy-path',
      label: 'Copy Path',
      run: () => {
        const file = files.get(tabId)
        if (file) void navigator.clipboard.writeText(file.sourcePath)
      }
    },
    {
      id: 'split',
      label: group === 'primary' ? 'Open to the Side' : 'Close Split',
      run: toggleSplit
    }
  ]

  return (
    <section
      className={`editor-group${activeGroup === group ? ' editor-group--focused' : ''}`}
      aria-label={group === 'primary' ? 'Editor' : 'Second editor'}
    >
      <div className="tab-bar" role="tablist">
        <div className="tab-bar__tabs">
          {paths.map((tabId) => {
            const file = files.get(tabId)
            if (!file) return null

            return (
              <div
                key={tabId}
                role="tab"
                tabIndex={0}
                aria-selected={active === tabId}
                className={
                  'tab' +
                  (active === tabId ? ' tab--active' : '') +
                  (file.kind === 'diff' ? ' tab--diff' : '')
                }
                onClick={() => setActive(tabId, group)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setActive(tabId, group)
                }}
                onAuxClick={(event) => {
                  // Middle-click closes, as in every browser and editor.
                  if (event.button === 1) void closeFile(tabId, group)
                }}
                onContextMenu={(event) => {
                  setMenuTab(tabId)
                  menu.open(event)
                }}
                title={file.sourcePath}
              >
                <span className="tab__icon">
                  <FileIcon name={file.name.replace(/ \(diff\)$/, '')} size={13} />
                </span>
                <span className="tab__name truncate">{file.name}</span>
                <button
                  type="button"
                  className={`tab__close${file.dirty ? ' tab__close--dirty' : ''}`}
                  aria-label={file.dirty ? `Close ${file.name} (unsaved)` : `Close ${file.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void closeFile(tabId, group)
                  }}
                >
                  {file.dirty ? <span className="tab__dot" /> : <CloseIcon size={12} />}
                </button>
              </div>
            )
          })}
        </div>

        {group === 'primary' && (
          <button
            type="button"
            className="tab-bar__action"
            onClick={toggleSplit}
            title="Split editor (Ctrl+\)"
            aria-label="Split editor"
          >
            <SplitIcon size={15} />
          </button>
        )}
      </div>

      <Breadcrumbs group={group} />

      <div className="editor-group__body">
        {/* The text editor stays mounted behind a diff so that returning to a
            file tab keeps its undo history, scroll position and folding. */}
        <MonacoHost group={group} />
        {showingDiff && activeFile && <DiffView path={activeFile.sourcePath} />}
      </div>

      {menu.position && menuTab && (
        <ContextMenu entries={tabMenu(menuTab)} position={menu.position} onDismiss={menu.close} />
      )}
    </section>
  )
}
