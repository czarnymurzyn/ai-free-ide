/**
 * The file explorer.
 *
 * Visible rows are computed by flattening the expanded tree into a single
 * array, which keeps rendering linear in what is on screen rather than in the
 * size of the workspace, and makes keyboard navigation a simple index walk.
 *
 * Creating and renaming happen inline, in the tree, rather than in a dialog:
 * you see where the file is landing and what its siblings are called while you
 * type the name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry } from '@shared/types.js'
import { FileIcon, FolderIconFor } from '../FileIcon.js'
import { ChevronDown, ChevronRight } from '../Icons.js'
import { ContextMenu, useContextMenu, type MenuEntry } from '../common/ContextMenu.js'
import { confirmDialog, validateFileName } from '../../state/dialogs.js'
import { useEditors } from '../../state/editors.js'
import { useGit } from '../../state/git.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './FileTree.css'

interface Row {
  entry: DirEntry
  depth: number
}

/** An in-progress inline edit: either renaming a row or naming a new entry. */
type Draft =
  | { mode: 'rename'; path: string; initial: string }
  | { mode: 'create'; parent: string; kind: 'file' | 'directory'; depth: number }

export function FileTree(): React.ReactElement {
  const { root, children, expanded, loading, toggle, open, refresh, scheduleIndexRefresh } =
    useWorkspace()
  const openFile = useEditors((s) => s.openFile)
  const activePath = useEditors((s) => s.active[s.activeGroup])
  const changes = useGit((s) => s.status.changes)
  const notify = useUi((s) => s.notify)

  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [menuTarget, setMenuTarget] = useState<DirEntry | null>(null)
  const menu = useContextMenu()

  /** path -> git status, for the colour of a row's label. */
  const gitByPath = useMemo(() => {
    const map = new Map<string, string>()
    if (!root) return map
    for (const change of changes) map.set(`${root}/${change.path}`, change.status)
    return map
  }, [changes, root])

  const rows = useMemo(() => {
    if (!root) return []
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children.get(dir) ?? []) {
        out.push({ entry, depth })
        if (entry.kind === 'directory' && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }, [root, children, expanded])

  const afterMutation = useCallback(
    async (paths: string[]) => {
      await refresh(paths)
      scheduleIndexRefresh()
    },
    [refresh, scheduleIndexRefresh]
  )

  const activate = useCallback(
    (entry: DirEntry) => {
      setSelected(entry.path)
      if (entry.kind === 'directory') void toggle(entry.path)
      else openFile(entry.path).catch((err: Error) => notify(err.message, 'error'))
    },
    [toggle, openFile, notify]
  )

  // ---------------------------------------------------------- operations

  const beginCreate = useCallback(
    async (anchor: DirEntry | null, kind: 'file' | 'directory') => {
      const parent = !anchor
        ? root!
        : anchor.kind === 'directory'
          ? anchor.path
          : anchor.path.slice(0, anchor.path.lastIndexOf('/'))

      // The new row has to be visible to be typed into, so make sure its
      // parent directory is expanded and loaded first.
      if (parent !== root && !expanded.has(parent)) await toggle(parent)

      const depth = parent === root ? 0 : (rows.find((r) => r.entry.path === parent)?.depth ?? 0) + 1
      setDraft({ mode: 'create', parent, kind, depth })
    },
    [root, expanded, toggle, rows]
  )

  const commitDraft = useCallback(
    async (name: string) => {
      const current = draft
      setDraft(null)
      // DraftRow validates before calling this, so an invalid name never
      // reaches here.
      if (!current || !name) return

      try {
        if (current.mode === 'create') {
          const path = `${current.parent}/${name}`
          await window.ide.fs.create(path, current.kind)
          await afterMutation([path])
          setSelected(path)
          if (current.kind === 'file') await openFile(path)
        } else {
          const parent = current.path.slice(0, current.path.lastIndexOf('/'))
          const next = `${parent}/${name}`
          if (next === current.path) return
          await window.ide.fs.rename(current.path, next)
          await afterMutation([current.path, next])
          setSelected(next)
        }
      } catch (err) {
        notify((err as Error).message, 'error')
      }
    },
    [draft, afterMutation, openFile, notify]
  )

  const remove = useCallback(
    async (entry: DirEntry) => {
      const ok = await confirmDialog({
        title: `Move "${entry.name}" to the trash?`,
        message:
          entry.kind === 'directory'
            ? 'The folder and everything in it will be moved to your desktop trash, where you can restore it.'
            : 'It will be moved to your desktop trash, where you can restore it.',
        confirmLabel: 'Move to Trash',
        danger: true
      })
      if (!ok) return

      try {
        await window.ide.fs.remove(entry.path)
        await afterMutation([entry.path])
      } catch (err) {
        notify((err as Error).message, 'error')
      }
    },
    [afterMutation, notify]
  )

  const menuEntries = useCallback(
    (entry: DirEntry | null): MenuEntry[] => {
      const items: MenuEntry[] = [
        {
          id: 'new-file',
          label: 'New File',
          run: () => void beginCreate(entry, 'file')
        },
        {
          id: 'new-folder',
          label: 'New Folder',
          run: () => void beginCreate(entry, 'directory')
        }
      ]

      if (entry) {
        items.push(
          { separator: true },
          {
            id: 'rename',
            label: 'Rename',
            hint: 'F2',
            run: () => setDraft({ mode: 'rename', path: entry.path, initial: entry.name })
          },
          {
            id: 'delete',
            label: 'Move to Trash',
            hint: 'Del',
            danger: true,
            run: () => void remove(entry)
          },
          { separator: true },
          {
            id: 'copy-path',
            label: 'Copy Path',
            run: () => void navigator.clipboard.writeText(entry.path)
          },
          {
            id: 'copy-relative',
            label: 'Copy Relative Path',
            run: () =>
              void navigator.clipboard.writeText(
                root && entry.path.startsWith(root) ? entry.path.slice(root.length + 1) : entry.path
              )
          },
          {
            id: 'reveal',
            label: 'Reveal in File Manager',
            run: () => void window.ide.fs.reveal(entry.path)
          }
        )
      }
      return items
    },
    [beginCreate, remove, root]
  )

  // ------------------------------------------------------------ keyboard

  const HANDLED_KEYS = new Set([
    'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft',
    'Enter', ' ', 'F2', 'Delete', 'ContextMenu'
  ])

  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const row = rows[index]
    if (!row || !HANDLED_KEYS.has(event.key)) return

    // The tree owns these keys while it has focus. Without stopping
    // propagation the window-level keybinding layer would also act on them --
    // F2 would start an inline rename here *and* Monaco's rename in the
    // editor, and the editor stealing focus would close the input instantly.
    event.preventDefault()
    event.stopPropagation()

    const focusRow = (target: number): void => {
      const next = rows[target]
      if (!next) return
      setSelected(next.entry.path)
      document.querySelector<HTMLElement>(`[data-tree-index="${target}"]`)?.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        focusRow(index + 1)
        break
      case 'ArrowUp':
        focusRow(index - 1)
        break
      case 'ArrowRight':
        if (row.entry.kind === 'directory' && !expanded.has(row.entry.path)) {
          void toggle(row.entry.path)
        } else {
          focusRow(index + 1)
        }
        break
      case 'ArrowLeft':
        if (row.entry.kind === 'directory' && expanded.has(row.entry.path)) {
          void toggle(row.entry.path)
        } else {
          // Jump to the parent directory's row.
          const parent = row.entry.path.slice(0, row.entry.path.lastIndexOf('/'))
          const parentIndex = rows.findIndex((r) => r.entry.path === parent)
          if (parentIndex !== -1) focusRow(parentIndex)
        }
        break
      case 'Enter':
      case ' ':
        activate(row.entry)
        break
      case 'F2':
        setDraft({ mode: 'rename', path: row.entry.path, initial: row.entry.name })
        break
      case 'Delete':
        void remove(row.entry)
        break
      case 'ContextMenu': {
        const box = (event.target as HTMLElement).getBoundingClientRect()
        setMenuTarget(row.entry)
        menu.open({
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
          clientX: box.left + 20,
          clientY: box.bottom
        } as React.MouseEvent)
        break
      }
    }
  }

  // -------------------------------------------------------------- render

  if (!root) {
    return (
      <div className="file-tree__empty">
        <p className="file-tree__empty-title">No folder open</p>
        <p className="file-tree__empty-body">
          Open a folder to browse, search and edit its files.
        </p>
        <button type="button" className="file-tree__open-button" onClick={() => void open()}>
          Open Folder
        </button>
        <p className="file-tree__empty-hint">
          <kbd>Ctrl</kbd> <kbd>K</kbd> then <kbd>Ctrl</kbd> <kbd>O</kbd>
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="file-tree__toolbar">
        <button
          type="button"
          className="file-tree__toolbar-button"
          onClick={() => void beginCreate(null, 'file')}
          title="New file in the workspace root"
        >
          New File
        </button>
        <button
          type="button"
          className="file-tree__toolbar-button"
          onClick={() => void beginCreate(null, 'directory')}
          title="New folder in the workspace root"
        >
          New Folder
        </button>
      </div>

      <div
        className="file-tree"
        role="tree"
        aria-label="Files"
        onContextMenu={(event) => {
          // A right-click on empty space targets the workspace root.
          if (event.target === event.currentTarget) {
            setMenuTarget(null)
            menu.open(event)
          }
        }}
      >
        {draft?.mode === 'create' && draft.parent === root && (
          <DraftRow depth={0} kind={draft.kind} onCommit={commitDraft} onCancel={() => setDraft(null)} />
        )}

        {rows.map((row, index) => {
          const { entry, depth } = row
          const isExpanded = expanded.has(entry.path)
          const isLoading = loading.has(entry.path)
          const gitStatus = gitByPath.get(entry.path)
          const renaming = draft?.mode === 'rename' && draft.path === entry.path

          return (
            <div key={entry.path}>
              {renaming ? (
                <DraftRow
                  depth={depth}
                  kind={entry.kind === 'directory' ? 'directory' : 'file'}
                  initial={draft.initial}
                  onCommit={commitDraft}
                  onCancel={() => setDraft(null)}
                />
              ) : (
                <div
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
                    setSelected(entry.path)
                    setMenuTarget(entry)
                    menu.open(event)
                  }}
                  title={entry.path}
                >
                  <span className="file-tree__chevron">
                    {entry.kind === 'directory' &&
                      (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                  </span>
                  <span className="file-tree__icon">
                    {entry.kind === 'directory' ? (
                      <FolderIconFor open={isExpanded} name={entry.name} />
                    ) : (
                      <FileIcon name={entry.name} />
                    )}
                  </span>
                  <span
                    className={`file-tree__name truncate${gitStatus ? ` file-tree__name--${gitStatus}` : ''}`}
                  >
                    {entry.name}
                  </span>
                  {isLoading && <span className="spinner" />}
                </div>
              )}

              {/* A new entry being named inside this directory. */}
              {draft?.mode === 'create' && draft.parent === entry.path && (
                <DraftRow
                  depth={depth + 1}
                  kind={draft.kind}
                  onCommit={commitDraft}
                  onCancel={() => setDraft(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      {menu.position && (
        <ContextMenu
          entries={menuEntries(menuTarget)}
          position={menu.position}
          onDismiss={menu.close}
        />
      )}
    </>
  )
}

/**
 * The inline input used for both renaming and naming a new entry.
 *
 * Commits on Enter or blur and cancels on Escape -- the behaviour of every
 * file manager, so it needs no explanation or buttons.
 */
function DraftRow({
  depth,
  kind,
  initial = '',
  onCommit,
  onCancel
}: {
  depth: number
  kind: 'file' | 'directory'
  initial?: string
  onCommit(name: string): void
  onCancel(): void
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const settled = useRef(false)
  const [value, setValue] = useState(initial)

  // Validate as you type so the icon updates with the extension and the error
  // appears before you commit, rather than after.
  const error = value.trim() ? validateFileName(value.trim()) : null

  useEffect(() => {
    const input = inputRef.current
    input?.focus()
    // Select the basename but leave the extension, so typing renames without
    // silently dropping `.ts`.
    const dot = initial.lastIndexOf('.')
    if (dot > 0) input?.setSelectionRange(0, dot)
    else input?.select()
  }, [initial])

  const commit = (): void => {
    if (settled.current) return
    const trimmed = value.trim()
    if (!trimmed || validateFileName(trimmed)) {
      // Nothing usable typed: abandon the row rather than leaving a stuck
      // input behind. Enter (below) keeps it open so it can be corrected.
      settled.current = true
      onCancel()
      return
    }
    settled.current = true
    onCommit(trimmed)
  }

  return (
    <div
      className="file-tree__row file-tree__row--draft"
      style={{ paddingLeft: 4 + depth * 12 }}
      title={error ?? undefined}
    >
      <span className="file-tree__chevron" />
      <span className="file-tree__icon">
        {kind === 'directory' ? (
          <FolderIconFor open={false} />
        ) : (
          <FileIcon name={value || 'untitled'} />
        )}
      </span>
      <input
        ref={inputRef}
        className={`file-tree__draft-input${error ? ' file-tree__draft-input--invalid' : ''}`}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label={kind === 'directory' ? 'Folder name' : 'File name'}
        aria-invalid={error !== null}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // The tree's own arrow-key navigation must not fire while typing.
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            // An invalid name keeps the row open and focused so it can be
            // fixed in place.
            if (!error && value.trim()) commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            settled.current = true
            onCancel()
          }
        }}
        onBlur={commit}
      />
    </div>
  )
}
