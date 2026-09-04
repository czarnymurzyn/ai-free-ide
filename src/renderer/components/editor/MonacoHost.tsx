/**
 * Hosts one Monaco editor instance for an editor group.
 *
 * One editor per group, with the model swapped on tab change, rather than one
 * editor per file. Monaco editors are expensive (each brings its own DOM,
 * workers and listeners), and swapping models preserves undo history because
 * the history lives on the model, not the editor.
 *
 * React 19's StrictMode mounts effects twice in development. Every resource
 * created here is therefore disposed in the cleanup, or the second mount
 * leaves an orphaned editor attached to the DOM node.
 */

import { useEffect, useRef } from 'react'
import type { GroupId } from '../../state/editors.js'
import { getModel, isDiffTab, useEditors } from '../../state/editors.js'
import { useGit } from '../../state/git.js'
import { useSettings } from '../../state/settings.js'
import { setActiveEditor } from '../../commands/registry.js'
import { editorOptions, monaco } from '../../monaco/setup.js'
import './MonacoHost.css'

interface Props {
  group: GroupId
}

export function MonacoHost({ group }: Props): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)

  const activeTab = useEditors((s) => s.active[group])
  // A diff tab is rendered by DiffView on top of this editor. Keeping the
  // previous file's model attached means switching back to it is instant and
  // keeps its undo history and scroll position.
  const path = activeTab && isDiffTab(activeTab) ? null : activeTab
  const settings = useSettings((s) => s.values)
  const setActiveGroup = useEditors((s) => s.setActiveGroup)
  const saveViewState = useEditors((s) => s.saveViewState)
  const gitStatus = useGit((s) => s.status)

  // --- create the editor once -------------------------------------------
  useEffect(() => {
    if (!container.current) return

    const editor = monaco.editor.create(container.current, {
      ...editorOptions(settings),
      model: null,
      theme: settings['workbench.theme']
    })
    editorRef.current = editor
    decorations.current = editor.createDecorationsCollection()

    const focusListener = editor.onDidFocusEditorText(() => {
      setActiveEditor(editor)
      setActiveGroup(group)
    })

    return () => {
      focusListener.dispose()
      // Detach the model first: disposing an editor that still owns a model
      // does not dispose the model, but leaving it attached to a destroyed
      // editor leaks the view zones.
      editor.setModel(null)
      editor.dispose()
      editorRef.current = null
      decorations.current = null
    }
    // Created once for the lifetime of the group; settings are applied by the
    // separate effect below rather than by recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group])

  // --- swap the model when the active tab changes -----------------------
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const previous = editor.getModel()
    if (previous) {
      // Remember where the user was before leaving this file.
      const viewState = editor.saveViewState()
      saveViewState(previous.uri.fsPath, viewState)
    }

    if (!path) {
      // Only a genuinely empty group clears the editor. When a diff is the
      // active tab the previous model stays attached underneath it.
      if (!activeTab) editor.setModel(null)
      return
    }

    const model = getModel(path)
    if (!model) return

    editor.setModel(model)

    const stored = useEditors.getState().viewState.get(path)
    if (stored) editor.restoreViewState(stored)
    editor.focus()
  }, [path, activeTab, saveViewState])

  // --- apply settings changes without recreating the editor -------------
  useEffect(() => {
    editorRef.current?.updateOptions(editorOptions(settings))
  }, [settings])

  // --- git gutter decorations -------------------------------------------
  useEffect(() => {
    if (!path || !decorations.current || !gitStatus.isRepo) {
      decorations.current?.clear()
      return
    }

    let cancelled = false
    void window.ide.git
      .hunks(path)
      .then((hunks) => {
        if (cancelled || !decorations.current) return
        decorations.current.set(
          hunks.map((hunk) => ({
            range: new monaco.Range(hunk.start, 1, hunk.start + Math.max(hunk.count - 1, 0), 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: `git-gutter git-gutter--${hunk.type}`,
              overviewRuler: {
                color:
                  hunk.type === 'added'
                    ? '#4ec9a5'
                    : hunk.type === 'deleted'
                      ? '#f0625d'
                      : '#e2b341',
                position: monaco.editor.OverviewRulerLane.Left
              }
            }
          }))
        )
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [path, gitStatus])

  return (
    <div className="monaco-host">
      <div ref={container} className="monaco-host__container" />
      {!activeTab && <Welcome />}
    </div>
  )
}

/**
 * The empty state.
 *
 * It does two jobs: teach the four shortcuts that make the editor usable, and
 * state plainly what this application is -- which for this project is the
 * whole point, and is otherwise only visible as one small status-bar word.
 */
function Welcome(): React.ReactElement {
  const shortcuts: Array<[string[], string]> = [
    [['Ctrl', 'P'], 'Go to file'],
    [['Ctrl', 'Shift', 'P'], 'Command palette'],
    [['Ctrl', 'Shift', 'F'], 'Search in files'],
    [['Ctrl', '`'], 'Terminal']
  ]

  return (
    <div className="monaco-host__placeholder">
      <div className="welcome">
        <h1 className="welcome__title">AI-Free IDE</h1>
        <p className="welcome__tagline">
          No network. No AI. No telemetry.
          <br />
          Everything here runs on this machine.
        </p>

        <dl className="welcome__shortcuts">
          {shortcuts.map(([keys, label]) => (
            <div className="welcome__shortcut" key={label}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
