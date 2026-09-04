/**
 * Find in files.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from '../Icons.js'
import { getActiveEditor } from '../../commands/registry.js'
import { confirmDialog } from '../../state/dialogs.js'
import { useEditors } from '../../state/editors.js'
import { useSearch } from '../../state/search.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './SearchPanel.css'

export function SearchPanel(): React.ReactElement {
  const search = useSearch()
  const openFile = useEditors((s) => s.openFile)
  const root = useWorkspace((s) => s.root)
  const notify = useUi((s) => s.notify)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showReplace, setShowReplace] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search as the user types, but not on every keystroke.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!search.pattern) return

    debounce.current = setTimeout(() => void search.run(), 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
    // Re-running when `search` identity changes would loop; the pattern and
    // the flags are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.pattern, search.caseSensitive, search.wholeWord, search.isRegex])

  if (!root) {
    return <p className="search-panel__empty">Open a folder to search in it.</p>
  }

  const openMatch = async (path: string, line: number, column: number): Promise<void> => {
    try {
      await openFile(path)
      // The editor needs a frame to mount the model before it can reveal.
      requestAnimationFrame(() => {
        const editor = getActiveEditor()
        editor?.revealLineInCenter(line)
        editor?.setPosition({ lineNumber: line, column })
        editor?.focus()
      })
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <div className="search-panel">
      <div className="search-panel__form">
        <div className="search-panel__row">
          <input
            data-search-input
            type="text"
            className="search-panel__input"
            placeholder="Search"
            value={search.pattern}
            onChange={(event) => search.setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search.run()
            }}
            aria-label="Search pattern"
          />
          <div className="search-panel__flags">
            <FlagButton
              label="Aa"
              title="Match case"
              active={search.caseSensitive}
              onClick={() => search.toggle('caseSensitive')}
            />
            <FlagButton
              label="ab"
              title="Match whole word"
              active={search.wholeWord}
              onClick={() => search.toggle('wholeWord')}
            />
            <FlagButton
              label=".*"
              title="Use regular expression"
              active={search.isRegex}
              onClick={() => search.toggle('isRegex')}
            />
          </div>
        </div>

        <button
          type="button"
          className="search-panel__toggle-replace"
          onClick={() => setShowReplace((v) => !v)}
        >
          {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Replace
        </button>

        {showReplace && (
          <div className="search-panel__row">
            <input
              type="text"
              className="search-panel__input"
              placeholder="Replace"
              value={search.replacement}
              onChange={(event) => search.setReplacement(event.target.value)}
              aria-label="Replacement text"
            />
            <button
              type="button"
              className="search-panel__replace-all"
              disabled={search.results.length === 0}
              onClick={() => {
                const count = search.results.reduce((n, r) => n + r.matches.length, 0)
                const files = search.results.length
                void confirmDialog({
                  title: `Replace ${count} occurrence${count === 1 ? '' : 's'}?`,
                  message: `Across ${files} file${files === 1 ? '' : 's'}. The files are written directly, so use undo in each editor or your version control to reverse this.`,
                  confirmLabel: 'Replace All',
                  danger: true
                }).then((ok) => {
                  if (ok) void search.replaceAll()
                })
              }}
            >
              All
            </button>
          </div>
        )}

        <div className="search-panel__row search-panel__row--globs">
          <input
            type="text"
            className="search-panel__input search-panel__input--small"
            placeholder="files to include"
            value={search.includeGlob}
            onChange={(event) => search.setGlob('includeGlob', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search.run()
            }}
            aria-label="Files to include"
          />
          <input
            type="text"
            className="search-panel__input search-panel__input--small"
            placeholder="files to exclude"
            value={search.excludeGlob}
            onChange={(event) => search.setGlob('excludeGlob', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search.run()
            }}
            aria-label="Files to exclude"
          />
        </div>
      </div>

      <div className="search-panel__summary">
        {search.running && <span className="spinner" />}
        {search.error && <span className="search-panel__error">{search.error}</span>}
        {!search.running && search.summary && (
          <span>
            {search.summary.matches} result{search.summary.matches === 1 ? '' : 's'} in{' '}
            {search.summary.files} file{search.summary.files === 1 ? '' : 's'}
            {search.summary.truncated && ' (truncated)'}
          </span>
        )}
      </div>

      <div className="search-panel__results">
        {search.results.map((result) => {
          const relative = root ? result.path.slice(root.length + 1) : result.path
          const isCollapsed = collapsed.has(result.path)

          return (
            <div key={result.path} className="search-result">
              <button
                type="button"
                className="search-result__file"
                onClick={() => {
                  const next = new Set(collapsed)
                  if (next.has(result.path)) next.delete(result.path)
                  else next.add(result.path)
                  setCollapsed(next)
                }}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="truncate">{relative}</span>
                <span className="search-result__count">{result.matches.length}</span>
              </button>

              {!isCollapsed &&
                result.matches.map((match, index) => (
                  <button
                    key={`${match.line}:${match.column}:${index}`}
                    type="button"
                    className="search-result__match"
                    onClick={() => void openMatch(result.path, match.line, match.column)}
                    title={`${relative}:${match.line}:${match.column}`}
                  >
                    <span className="search-result__line">{match.line}</span>
                    <span className="search-result__preview truncate">
                      {highlight(match.preview, match.column - 1, match.length)}
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FlagButton({
  label,
  title,
  active,
  onClick
}: {
  label: string
  title: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`search-panel__flag${active ? ' search-panel__flag--active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

/** Wrap the matched span so it stands out in the result list. */
function highlight(text: string, start: number, length: number): React.ReactNode {
  if (start < 0 || length <= 0 || start > text.length) return text.trim()

  // Trim leading whitespace but keep the highlight aligned to what remains.
  const leading = text.length - text.trimStart().length
  const offset = Math.max(0, start - leading)
  const trimmed = text.trim()

  return (
    <>
      {trimmed.slice(0, offset)}
      <mark className="search-result__mark">{trimmed.slice(offset, offset + length)}</mark>
      {trimmed.slice(offset + length)}
    </>
  )
}
