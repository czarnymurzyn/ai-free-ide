/**
 * Imperative dialog API.
 *
 * Kept here rather than in the component so that stores and command handlers
 * can ask a question without importing from the component tree, and so the
 * call site reads the way the blocking `window.confirm` it replaces did:
 *
 *     if (await confirmDialog({ title: 'Discard changes?' })) { ... }
 *
 * `DialogHost` in components/common/Dialog.tsx subscribes and does the
 * rendering.
 */

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  message?: string
  confirmLabel: string
  danger: boolean
  resolve(value: boolean): void
}

export interface PromptRequest {
  kind: 'prompt'
  title: string
  message?: string
  initialValue: string
  confirmLabel: string
  /** Return an error string to block submission, or null when valid. */
  validate?(value: string): string | null
  resolve(value: string | null): void
}

export type DialogRequest = ConfirmRequest | PromptRequest

let publish: ((request: DialogRequest) => void) | null = null

/** Called once by DialogHost when it mounts. */
export function setDialogSink(sink: ((request: DialogRequest) => void) | null): void {
  publish = sink
}

export function confirmDialog(options: {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    // With no host mounted (a test harness, or during teardown) the safe
    // answer is "no" -- never silently proceed with a destructive action.
    if (!publish) {
      resolve(false)
      return
    }
    publish({
      kind: 'confirm',
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      danger: options.danger ?? false,
      resolve
    })
  })
}

export function promptDialog(options: {
  title: string
  message?: string
  initialValue?: string
  confirmLabel?: string
  validate?(value: string): string | null
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!publish) {
      resolve(null)
      return
    }
    publish({
      kind: 'prompt',
      title: options.title,
      message: options.message,
      initialValue: options.initialValue ?? '',
      confirmLabel: options.confirmLabel ?? 'OK',
      validate: options.validate,
      resolve
    })
  })
}

/** Reject a name that cannot become a file on disk. Shared by every prompt. */
export function validateFileName(name: string): string | null {
  if (!name) return 'A name is required.'
  if (name === '.' || name === '..') return 'That name is reserved.'
  if (name.includes('/')) return 'A name cannot contain "/".'
  if (name.includes('\0')) return 'A name cannot contain a null character.'
  if (name.length > 255) return 'That name is too long.'
  return null
}
