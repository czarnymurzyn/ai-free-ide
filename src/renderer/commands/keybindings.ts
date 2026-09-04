/**
 * Keyboard shortcut dispatch.
 *
 * Monaco handles its own editing shortcuts internally; this layer covers the
 * workbench ones (palette, sidebar, panel, tabs). Events originating inside
 * the editor or the terminal are left alone unless the chord is one the
 * workbench owns exclusively, so typing a backtick in the terminal does not
 * toggle the terminal.
 */

import { runCommand, COMMANDS } from './registry.js'

/** Normalise a KeyboardEvent to the same spelling used in the registry. */
export function chordFor(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')

  let key = event.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  // Arrow keys come through as ArrowUp/ArrowDown; the registry spells them
  // Up/Down for readability in the palette.
  else if (key.startsWith('Arrow')) key = key.slice(5)

  parts.push(key)
  return parts.join('+')
}

/** chord -> command id, built once from the registry. */
const BINDINGS = new Map<string, string>()
for (const command of COMMANDS) {
  if (!command.keybinding) continue
  // Multi-stroke chords (Ctrl+K Ctrl+O) are handled separately below.
  if (command.keybinding.includes(' ')) continue
  if (!BINDINGS.has(command.keybinding)) BINDINGS.set(command.keybinding, command.id)
}

/** Chords the editor should keep for itself. */
const EDITOR_OWNED = new Set([
  'Ctrl+F',
  'Ctrl+H',
  'Ctrl+G',
  'Ctrl+/',
  'Ctrl+.',
  'F12',
  'Shift+F12',
  'F2',
  'F8',
  'Shift+F8',
  'Alt+Up',
  'Alt+Down',
  'Ctrl+Shift+O',
  'Ctrl+Shift+I',
  'Ctrl+Shift+D'
])

/** Two-stroke chords, keyed by the first stroke. */
const MULTI_STROKE: Record<string, Record<string, string>> = {
  'Ctrl+K': { 'Ctrl+O': 'workspace.open' }
}

let pendingPrefix: string | null = null
let prefixTimer: ReturnType<typeof setTimeout> | null = null

export function installKeybindings(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const chord = chordFor(event)
    const target = event.target as HTMLElement | null
    const inEditor = !!target?.closest('.monaco-editor')
    const inTerminal = !!target?.closest('.terminal-instance')
    const inTextField =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable

    // Resolve the second stroke of a pending multi-stroke chord.
    if (pendingPrefix) {
      const next = MULTI_STROKE[pendingPrefix]?.[chord]
      clearPrefix()
      if (next) {
        event.preventDefault()
        runCommand(next)
        return
      }
    }

    if (MULTI_STROKE[chord]) {
      event.preventDefault()
      pendingPrefix = chord
      // Abandon a half-typed chord rather than leaving it armed forever.
      prefixTimer = setTimeout(clearPrefix, 1500)
      return
    }

    // Escape closes any overlay; handled by the overlay components.
    if (chord === 'Escape') return

    const commandId = BINDINGS.get(chord)
    if (!commandId) return

    // The terminal must receive everything except the toggle that hides it.
    if (inTerminal && chord !== 'Ctrl+`') return
    // Let Monaco handle its own shortcuts when the editor has focus.
    if (inEditor && EDITOR_OWNED.has(chord)) return
    // A plain text field keeps single-key and text-editing chords.
    if (inTextField && !chord.startsWith('Ctrl') && !chord.startsWith('Alt')) return

    event.preventDefault()
    runCommand(commandId)
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}

function clearPrefix(): void {
  pendingPrefix = null
  if (prefixTimer) clearTimeout(prefixTimer)
  prefixTimer = null
}
