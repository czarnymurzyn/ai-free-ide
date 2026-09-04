/**
 * Side-by-side diff of a file against HEAD.
 *
 * Source control previously just opened the file, which told you *that* it had
 * changed but not *what* changed -- you had to run `git diff` in the terminal.
 * This renders Monaco's diff editor with the committed version on the left and
 * the working tree on the right.
 *
 * The right-hand side is editable and writes through to disk, so a diff is a
 * place you can fix something rather than a dead end.
 */

import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../state/settings.js'
import { editorOptions, monaco } from '../../monaco/setup.js'
import { languageIdFor } from '@shared/languages.js'
import './DiffView.css'

interface Props {
  /** Absolute path of the file being compared. */
  path: string
}

export function DiffView({ path }: Props): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const settings = useSettings((s) => s.values)
  const [state, setState] = useState<'loading' | 'ready' | 'untracked' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [inline, setInline] = useState(false)

  useEffect(() => {
    if (!container.current) return

    const editor = monaco.editor.createDiffEditor(container.current, {
      ...editorOptions(settings),
      theme: settings['workbench.theme'],
      readOnly: false,
      originalEditable: false,
      renderSideBySide: !inline,
      ignoreTrimWhitespace: false,
      renderOverviewRuler: true,
      diffWordWrap: 'off'
    })
    editorRef.current = editor

    let disposed = false
    const models: monaco.editor.ITextModel[] = []

    void (async () => {
      try {
        const [head, working] = await Promise.all([
          window.ide.git.fileAtHead(path),
          window.ide.fs.read(path)
        ])
        if (disposed) return

        if (head === null) {
          // Untracked: there is no committed side to compare against.
          setState('untracked')
          return
        }

        const languageId = languageIdFor(path)
        // Detached models with no URI: they must not collide with the models
        // the normal editor owns for the same file.
        const original = monaco.editor.createModel(head, languageId)
        const modified = monaco.editor.createModel(working.text, languageId)
        models.push(original, modified)

        editor.setModel({ original, modified })
        setState('ready')
      } catch (err) {
        if (disposed) return
        setMessage((err as Error).message)
        setState('error')
      }
    })()

    return () => {
      disposed = true
      // Detach before disposing, or the editor keeps a handle on models that
      // are about to be destroyed.
      editor.setModel(null)
      editor.dispose()
      for (const model of models) model.dispose()
      editorRef.current = null
    }
  }, [path, settings, inline])

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <span className="diff-view__label">
          <span className="diff-view__side diff-view__side--original">HEAD</span>
          <span className="diff-view__arrow">→</span>
          <span className="diff-view__side diff-view__side--modified">Working Tree</span>
        </span>

        <button
          type="button"
          className="diff-view__toggle"
          onClick={() => setInline((v) => !v)}
          title={inline ? 'Show side by side' : 'Show inline'}
        >
          {inline ? 'Side by side' : 'Inline'}
        </button>
      </div>

      <div ref={container} className="diff-view__container" />

      {state !== 'ready' && (
        <div className="diff-view__overlay">
          {state === 'loading' && <span className="spinner" />}
          {state === 'untracked' && (
            <p className="diff-view__note">
              This file is untracked, so there is no committed version to compare with.
            </p>
          )}
          {state === 'error' && <p className="diff-view__note diff-view__note--error">{message}</p>}
        </div>
      )}
    </div>
  )
}
