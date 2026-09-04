/**
 * The file explorer.
 *
 * The visible rows are computed by flattening the expanded tree into a single
 * array, which keeps rendering linear in what is on screen rather than in the
 * size of the workspace, and makes keyboard navigation a simple index walk.
 */

import { useCallback, useMemo, useState } from 'react'
import type { DirEntry } from '@shared/types.js'
import { ChevronDown, ChevronRight, FileIcon, FolderIcon } from '../Icons.js'
import { useEditors } from '../../state/editors.js'
import { useGit } from '../../state/git.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './FileTree.css'

interface Row {
  entry: DirEntry
  depth: number
}

export function FileTree(): React.ReactElement {
  const { root, children, expanded, loading, toggle, open, refresh } = useWorkspace()
  const openFile = useEditors((s) => s.openFile)
  const activePath = useEditors((s) => s.active[s.activeGroup])
  const changes = useGit((s) => s.status.changes)
  const notify = useUi((s) => s.notify)
  const [selected, setSelected] = useState<string | null>(null)

  /** path -> git status, for the colour of a row's label. */
  const gitByPath = useMemo(() => {
    const map = new Map<string, string>()
    if (!root) return map
    for (const change of changes) {
      map.set(`${root}/${change.path}`, change.status)
    }
    return map
  }, [changes, root])

  const rows = useMemo(() => {
    if (!root) return []
    const out: Row[] = []

    const walk = (dir: string, depth: number): void => {
      for (const entry of children.get(dir) ?? []) {
        out.push({ entry, depth })
        if (entry.kind === 'directory' && expanded.has(entry.path)) {
          walk(entry.path, depth + 1)
        }
      }
    }
    walk(root, 0)
    return out
  }, [root, children, expanded])

  const activate = useCallback(
    (entry: DirEntry) => {
      setSelected(entry.path)
      if (entry.kind === 'directory') {
        void toggle(entry.path)
      } else {
        openFile(entry.path).catch((err: Error) => notify(err.message, 'error'))
      }
    },
    [toggle, openFile, notify]
  )

  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const row = rows[index]
    if (!row) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        setSelected(next.entry.path)
        document.querySelector<HTMLElement>(`[data-tree-index="${index + (event.key === 'ArrowDown' ? 1 : -1)}"]`)?.focus()
      }
    } else if (event.key === 'ArrowRight' && row.entry.kind === 'directory') {
      event.preventDefault()
      if (!expanded.has(row.entry.path)) void toggle(row.entry.path)
    } else if (event.key === 'ArrowLeft' && row.entry.kind === 'directory') {
      event.preventDefault()
      if (expanded.has(row.entry.path)) void toggle(row.entry.path)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate(row.entry)
    } else if (event.key === 'F2') {
      event.preventDefault()
      void renameEntry(row.entry, refresh, notify)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      void deleteEntry(row.entry, refresh, notify)
    }
  }

  if (!root) {
    return (
      <div className="file-tree__empty">
        <p>No folder is open.</p>
        <button type="button" className="file-tree__open-button" onClick={() => void open()}>
          Open Folder
        </button>
      </div>
    )
  }

  return (
    <div className="file-tree" role="tree" aria-label="Files">
      {rows.map((row, index) => {
        const { entry, depth } = row
        const isExpanded = expanded.has(entry.path)
        const isLoading = loading.has(entry.path)
        const gitStatus = gitByPath.get(entry.path)

        return (
          <div
            key={entry.path}
            role="treeitem"
            tabIndex={selected === entry.path ? 0 : -1}
            data-tree-index={index}
            aria-expanded={entry.kind === 'directory' ? isExpanded : undefined}
            aria-selected={activePath === entry.path}
            className={
              'file-tree__row' +
              (activePath === entry.path ? ' file-tree__row--active' : '') +
              (selected === entry.path ? ' file-tree__row--selected' : '')
            }
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => activate(entry)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onContextMenu={(event) => {
              event.preventDefault()
              setSelected(entry.path)
              void showContextMenu(entry, refresh, notify)
            }}
            title={entry.path}
          >
            <span className="file-tree__chevron">
              {entry.kind === 'directory' &&
                (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
            </span>
            <span className="file-tree__icon">
              {entry.kind === 'directory' ? <FolderIcon size={14} /> : <FileIcon size={14} />}
            </span>
            <span
              className={`file-tree__name truncate${gitStatus ? ` file-tree__name--${gitStatus}` : ''}`}
            >
              {entry.name}
            </span>
            {isLoading && <span className="spinner" />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Context actions.
 *
 * window.prompt and window.confirm are used deliberately: they are native,
 * synchronous, keyboard-accessible, and need no extra modal machinery for
 * operations this simple.
 */
async function showContextMenu(
  entry: DirEntry,
  refresh: (paths: string[]) => Promise<void>,
  notify: (text: string, kind?: 'info' | 'error') => void
): Promise<void> {
  const action = window.prompt(
    `${entry.name}\n\nType an action:\n  n = new file\n  d = new folder\n  r = rename\n  x = delete\n  v = reveal in file manager`,
    'n'
  )
  if (!action) return

  const parentDir = entry.kind === 'directory' ? entry.path : entry.path.slice(0, entry.path.lastIndexOf('/'))

  try {
    switch (action.trim().toLowerCase()) {
      case 'n':
      case 'd': {
        const name = window.prompt(action === 'n' ? 'New file name:' : 'New folder name:')
        if (!name) return
        await window.ide.fs.create(`${parentDir}/${name}`, action === 'n' ? 'file' : 'directory')
        await refresh([`${parentDir}/${name}`])
        break
      }
      case 'r':
        await renameEntry(entry, refresh, notify)
        break
      case 'x':
        await deleteEntry(entry, refresh, notify)
        break
      case 'v':
        await window.ide.fs.reveal(entry.path)
        break
    }
  } catch (err) {
    notify((err as Error).message, 'error')
  }
}

async function renameEntry(
  entry: DirEntry,
  refresh: (paths: string[]) => Promise<void>,
  notify: (text: string, kind?: 'info' | 'error') => void
): Promise<void> {
  const name = window.prompt('Rename to:', entry.name)
  if (!name || name === entry.name) return
  const parent = entry.path.slice(0, entry.path.lastIndexOf('/'))
  try {
    await window.ide.fs.rename(entry.path, `${parent}/${name}`)
    await refresh([entry.path, `${parent}/${name}`])
  } catch (err) {
    notify((err as Error).message, 'error')
  }
}

async function deleteEntry(
  entry: DirEntry,
  refresh: (paths: string[]) => Promise<void>,
  notify: (text: string, kind?: 'info' | 'error') => void
): Promise<void> {
  // "Move to trash" rather than "delete", because that is what actually
  // happens -- the main process uses the desktop trash, so this is undoable.
  if (!window.confirm(`Move "${entry.name}" to the trash?`)) return
  try {
    await window.ide.fs.remove(entry.path)
    await refresh([entry.path])
  } catch (err) {
    notify((err as Error).message, 'error')
  }
}
