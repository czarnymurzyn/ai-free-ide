/**
 * Source control.
 *
 * Deliberately has no push, pull, fetch or sync control. The backend refuses
 * those, so offering a button that always errors would be worse than not
 * having one -- the panel's shape tells the truth about what this IDE does.
 */

import { useEffect } from 'react'
import type { GitChange } from '@shared/types.js'
import { DiscardIcon, RefreshIcon, StageIcon, UnstageIcon } from '../Icons.js'
import { partitionChanges, useGit } from '../../state/git.js'
import { useEditors } from '../../state/editors.js'
import { useUi } from '../../state/ui.js'
import { useWorkspace } from '../../state/workspace.js'
import './SourceControlPanel.css'

export function SourceControlPanel(): React.ReactElement {
  const git = useGit()
  const root = useWorkspace((s) => s.root)
  const openFile = useEditors((s) => s.openFile)
  const setOverlay = useUi((s) => s.setOverlay)

  useEffect(() => {
    void git.refresh().then(() => {
      void git.refreshBranches()
      void git.refreshLog()
    })
    // Refresh once when the panel mounts; the watcher drives updates after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  if (!root) {
    return <p className="scm__empty">Open a folder to use source control.</p>
  }

  if (!git.status.isRepo) {
    return (
      <p className="scm__empty">
        This folder is not a Git repository.
        <br />
        <br />
        Run <code>git init</code> in the terminal to start one.
      </p>
    )
  }

  const { staged, unstaged } = partitionChanges(git.status.changes)
  const absolute = (change: GitChange): string => `${root}/${change.path}`

  return (
    <div className="scm">
      <div className="scm__header">
        <button
          type="button"
          className="scm__branch"
          onClick={() => {
            void git.refreshBranches()
            setOverlay('branches')
          }}
          title="Checkout a local branch"
        >
          {git.status.detached ? 'detached HEAD' : (git.status.branch ?? 'no branch')}
        </button>
        <button
          type="button"
          className="scm__icon-button"
          onClick={() => void git.refresh()}
          title="Refresh"
          aria-label="Refresh source control"
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      <div className="scm__commit">
        <textarea
          className="scm__message"
          placeholder={git.amend ? 'Amend the previous commit…' : 'Commit message'}
          value={git.commitMessage}
          onChange={(event) => git.setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl+Enter commits, matching the menu accelerator.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void git.commit()
            }
          }}
          rows={3}
          aria-label="Commit message"
        />
        <div className="scm__commit-actions">
          <label className="scm__amend">
            <input
              type="checkbox"
              checked={git.amend}
              onChange={(event) => git.setAmend(event.target.checked)}
            />
            Amend
          </label>
          <button
            type="button"
            className="scm__commit-button"
            disabled={git.busy || (!git.commitMessage.trim() && !git.amend)}
            onClick={() => void git.commit()}
          >
            {git.busy ? 'Working…' : 'Commit'}
          </button>
        </div>
        {git.error && <p className="scm__error">{git.error}</p>}
      </div>

      <div className="scm__sections">
        <Section
          title="Staged Changes"
          changes={staged}
          emptyLabel="Nothing staged"
          onOpen={(change) => void openFile(absolute(change))}
          actions={[
            {
              Icon: UnstageIcon,
              label: 'Unstage',
              run: (change) => void git.unstage([change.path])
            }
          ]}
          headerAction={
            staged.length > 0
              ? { label: 'Unstage all', run: () => void git.unstage(staged.map((c) => c.path)) }
              : undefined
          }
        />

        <Section
          title="Changes"
          changes={unstaged}
          emptyLabel="No changes"
          onOpen={(change) => void openFile(absolute(change))}
          actions={[
            {
              Icon: DiscardIcon,
              label: 'Discard',
              run: (change) => {
                if (window.confirm(`Discard all changes to ${change.path}? This cannot be undone.`)) {
                  void git.discard([change.path])
                }
              }
            },
            {
              Icon: StageIcon,
              label: 'Stage',
              run: (change) => void git.stage([change.path])
            }
          ]}
          headerAction={
            unstaged.length > 0
              ? { label: 'Stage all', run: () => void git.stage(unstaged.map((c) => c.path)) }
              : undefined
          }
        />

        {git.commits.length > 0 && (
          <div className="scm__section">
            <div className="scm__section-header">
              <span>History</span>
            </div>
            {git.commits.slice(0, 30).map((commit) => (
              <div key={commit.hash} className="scm__commit-row" title={`${commit.hash}\n${commit.author}`}>
                <span className="scm__commit-hash">{commit.shortHash}</span>
                <span className="scm__commit-subject truncate">{commit.subject}</span>
                <span className="scm__commit-date">{commit.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Action {
  Icon: (props: { size?: number }) => React.ReactElement
  label: string
  run(change: GitChange): void
}

function Section({
  title,
  changes,
  emptyLabel,
  onOpen,
  actions,
  headerAction
}: {
  title: string
  changes: GitChange[]
  emptyLabel: string
  onOpen(change: GitChange): void
  actions: Action[]
  headerAction?: { label: string; run(): void }
}): React.ReactElement {
  return (
    <div className="scm__section">
      <div className="scm__section-header">
        <span>
          {title} {changes.length > 0 && <span className="scm__section-count">{changes.length}</span>}
        </span>
        {headerAction && (
          <button type="button" className="scm__section-action" onClick={headerAction.run}>
            {headerAction.label}
          </button>
        )}
      </div>

      {changes.length === 0 ? (
        <p className="scm__section-empty">{emptyLabel}</p>
      ) : (
        changes.map((change) => (
          <div
            key={`${change.staged ? 's' : 'u'}:${change.path}`}
            className="scm__change"
            onClick={() => onOpen(change)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(change)
            }}
            role="button"
            tabIndex={0}
            title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}
          >
            <span className={`scm__change-name truncate scm__change-name--${change.status}`}>
              {change.path.split('/').pop()}
            </span>
            <span className="scm__change-dir truncate">
              {change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}
            </span>
            <span className="scm__change-actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="scm__icon-button"
                  title={action.label}
                  aria-label={`${action.label} ${change.path}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    action.run(change)
                  }}
                >
                  <action.Icon size={13} />
                </button>
              ))}
              <span className={`scm__badge scm__badge--${change.status}`}>
                {statusLetter(change.status)}
              </span>
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function statusLetter(status: GitChange['status']): string {
  switch (status) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return 'U'
    case 'conflicted': return '!'
  }
}
