/**
 * Coordinate conversion between LSP and the editor.
 *
 * LSP counts lines and characters from 0. Monaco counts lines and columns
 * from 1. Every crossing in the app goes through these four functions.
 *
 * They live here, free of any monaco import, for two reasons: an off-by-one
 * in this file does not crash anything -- it quietly puts every diagnostic and
 * every go-to-definition one line or column off, which is hard to notice and
 * harder to trace -- and keeping them pure means they can be tested directly.
 */

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface EditorPosition {
  lineNumber: number
  column: number
}

export interface EditorRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** LSP (0-based) -> editor (1-based). */
export function toMonacoPosition(position: LspPosition): EditorPosition {
  return { lineNumber: position.line + 1, column: position.character + 1 }
}

/** Editor (1-based) -> LSP (0-based). */
export function toLspPosition(position: EditorPosition): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toMonacoRange(range: LspRange): EditorRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

export function toLspRange(range: EditorRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  }
}

/**
 * Monaco's MarkerSeverity values. Declared as literals rather than imported so
 * this module stays dependency-free; they are part of Monaco's public API and
 * are asserted against the real enum in the bridge's tests.
 */
export const MARKER_SEVERITY = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8
} as const

/** LSP DiagnosticSeverity (1-4) -> Monaco MarkerSeverity. */
export function toMarkerSeverity(severity: number | undefined): number {
  switch (severity) {
    case 1: return MARKER_SEVERITY.Error
    case 2: return MARKER_SEVERITY.Warning
    case 3: return MARKER_SEVERITY.Info
    case 4: return MARKER_SEVERITY.Hint
    // The specification says an omitted severity is up to the client; treating
    // it as an error keeps a real problem from being rendered as a hint.
    default: return MARKER_SEVERITY.Error
  }
}
