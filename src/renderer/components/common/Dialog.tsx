/**
 * Modal confirm and prompt dialogs.
 *
 * These replace window.confirm/window.prompt, which block the whole renderer,
 * cannot be styled or themed, and render as a Chromium alert bar pinned to the
 * top of the window rather than as part of the app.
 *
 * The imperative API lives in state/dialogs.ts; this file only renders what is
 * pending. Mount `DialogHost` once, at the app root.
 */

import { useEffect, useRef, useState } from 'react'
import { setDialogSink, type DialogRequest } from '../../state/dialogs.js'
import './Dialog.css'

export function DialogHost(): React.ReactElement | null {
  const [request, setRequest] = useState<DialogRequest | null>(null)

  useEffect(() => {
    setDialogSink(setRequest)
    return () => setDialogSink(null)
  }, [])

  if (!request) return null

  const dismiss = (): void => {
    // Cancelling resolves rather than rejects, so callers can await without
    // wrapping every call in a try/catch.
    if (request.kind === 'confirm') request.resolve(false)
    else request.resolve(null)
    setRequest(null)
  }

  return (
    <DialogBody
      // Remount on each new request so the input resets to its initial value.
      key={`${request.kind}:${request.title}`}
      request={request}
      onClose={() => setRequest(null)}
      onDismiss={dismiss}
    />
  )
}

function DialogBody({
  request,
  onClose,
  onDismiss
}: {
  request: DialogRequest
  onClose(): void
  onDismiss(): void
}): React.ReactElement {
  const [value, setValue] = useState(request.kind === 'prompt' ? request.initialValue : '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (request.kind === 'prompt') {
      const input = inputRef.current
      input?.focus()
      // Select the basename but not the extension, so typing replaces the name
      // and keeps `.ts` -- the behaviour every file manager has.
      const dot = request.initialValue.lastIndexOf('.')
      if (dot > 0) input?.setSelectionRange(0, dot)
      else input?.select()
    } else {
      confirmRef.current?.focus()
    }
  }, [request])

  const submit = (): void => {
    if (request.kind === 'confirm') {
      request.resolve(true)
      onClose()
      return
    }

    const trimmed = value.trim()
    const problem = request.validate?.(trimmed) ?? (trimmed ? null : 'A name is required.')
    if (problem) {
      setError(problem)
      return
    }
    request.resolve(trimmed)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onDismiss()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key !== 'Tab') return

    // Trap focus: a modal that lets Tab reach the editor behind it strands
    // keyboard users outside the dialog they are supposed to answer.
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog__backdrop" onMouseDown={onDismiss}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog__title" id="dialog-title">
          {request.title}
        </h2>

        {request.message && <p className="dialog__message">{request.message}</p>}

        {request.kind === 'prompt' && (
          <>
            <input
              ref={inputRef}
              type="text"
              className="dialog__input"
              value={value}
              spellCheck={false}
              autoComplete="off"
              aria-label={request.title}
              aria-invalid={error !== null}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
            />
            {error && (
              <p className="dialog__error" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onDismiss}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={
              'dialog__button dialog__button--primary' +
              (request.kind === 'confirm' && request.danger ? ' dialog__button--danger' : '')
            }
            onClick={submit}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
