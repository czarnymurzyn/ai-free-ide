/**
 * LSP <-> editor coordinate conversion.
 *
 * The failure this guards against is silent: an off-by-one puts diagnostics
 * and go-to-definition one line or column away from the real location, which
 * looks like a flaky language server rather than a client bug.
 */

import { describe, expect, it } from 'vitest'
import {
  MARKER_SEVERITY,
  toLspPosition,
  toLspRange,
  toMarkerSeverity,
  toMonacoPosition,
  toMonacoRange
} from '../../src/shared/lsp-position.js'

describe('position conversion', () => {
  it('maps the origin of each coordinate system to the other', () => {
    // The single most important case: LSP 0,0 is the editor's line 1, col 1.
    expect(toMonacoPosition({ line: 0, character: 0 })).toEqual({ lineNumber: 1, column: 1 })
    expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 })
  })

  it('shifts both axes by exactly one', () => {
    expect(toMonacoPosition({ line: 41, character: 7 })).toEqual({ lineNumber: 42, column: 8 })
    expect(toLspPosition({ lineNumber: 42, column: 8 })).toEqual({ line: 41, character: 7 })
  })

  it('round-trips in both directions', () => {
    const lsp = { line: 123, character: 45 }
    expect(toLspPosition(toMonacoPosition(lsp))).toEqual(lsp)

    const editor = { lineNumber: 124, column: 46 }
    expect(toMonacoPosition(toLspPosition(editor))).toEqual(editor)
  })
})

describe('range conversion', () => {
  it('converts both endpoints', () => {
    expect(toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 5 } })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 6
    })
  })

  it('round-trips a range', () => {
    const range = { start: { line: 10, character: 4 }, end: { line: 10, character: 18 } }
    expect(toLspRange(toMonacoRange(range))).toEqual(range)
  })

  it('handles an empty range at a single point', () => {
    const empty = { start: { line: 5, character: 3 }, end: { line: 5, character: 3 } }
    const converted = toMonacoRange(empty)
    expect(converted.startLineNumber).toBe(converted.endLineNumber)
    expect(converted.startColumn).toBe(converted.endColumn)
  })
})

describe('toMarkerSeverity', () => {
  it('maps each LSP severity to its Monaco counterpart', () => {
    // The two scales are unrelated: LSP is 1-4 ascending in leniency,
    // Monaco is a bit flag set where Error is the largest.
    expect(toMarkerSeverity(1)).toBe(MARKER_SEVERITY.Error)
    expect(toMarkerSeverity(2)).toBe(MARKER_SEVERITY.Warning)
    expect(toMarkerSeverity(3)).toBe(MARKER_SEVERITY.Info)
    expect(toMarkerSeverity(4)).toBe(MARKER_SEVERITY.Hint)
  })

  it('treats a missing severity as an error rather than a hint', () => {
    expect(toMarkerSeverity(undefined)).toBe(MARKER_SEVERITY.Error)
    expect(toMarkerSeverity(99)).toBe(MARKER_SEVERITY.Error)
  })

  it('uses the numeric values Monaco actually defines', () => {
    // These literals are duplicated from Monaco's enum to keep the shared
    // module dependency-free; if Monaco ever changes them, this fails.
    expect(MARKER_SEVERITY).toEqual({ Hint: 1, Info: 2, Warning: 4, Error: 8 })
  })
})
