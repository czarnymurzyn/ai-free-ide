/**
 * The editor region: one or two groups, each with its own tab bar.
 */

import { CloseIcon, SplitIcon } from '../Icons.js'
import { useEditors, type GroupId } from '../../state/editors.js'
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

  return (
    <section
      className={`editor-group${activeGroup === group ? ' editor-group--focused' : ''}`}
      aria-label={group === 'primary' ? 'Editor' : 'Second editor'}
    >
      <div className="tab-bar" role="tablist">
        <div className="tab-bar__tabs">
          {paths.map((path) => {
            const file = files.get(path)
            if (!file) return null

            return (
              <div
                key={path}
                role="tab"
                tabIndex={0}
                aria-selected={active === path}
                className={`tab${active === path ? ' tab--active' : ''}`}
                onClick={() => setActive(path, group)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setActive(path, group)
                }}
                onAuxClick={(event) => {
                  // Middle-click closes, as in every browser and editor.
                  if (event.button === 1) void closeFile(path, group)
                }}
                title={path}
              >
                <span className="tab__name truncate">{file.name}</span>
                <button
                  type="button"
                  className={`tab__close${file.dirty ? ' tab__close--dirty' : ''}`}
                  aria-label={file.dirty ? `Close ${file.name} (unsaved)` : `Close ${file.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void closeFile(path, group)
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

      <MonacoHost group={group} />
    </section>
  )
}
