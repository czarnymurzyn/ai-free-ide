/**
 * Language-server status and the Problems list.
 */

import type * as monaco from 'monaco-editor'
import { create } from 'zustand'
import type { LanguageServerStatus } from '@shared/types.js'

export interface Problem {
  path: string
  marker: monaco.editor.IMarkerData
}

interface LspState {
  servers: LanguageServerStatus[]
  /** Markers by absolute file path. */
  diagnostics: Map<string, monaco.editor.IMarkerData[]>

  setServers(servers: LanguageServerStatus[]): void
  setDiagnostics(path: string, markers: monaco.editor.IMarkerData[]): void
  clearDiagnostics(path: string): void
  problems(): Problem[]
  counts(): { errors: number; warnings: number }
}

/**
 * Flatten the diagnostics map into a sorted list.
 *
 * Kept as a free function, and deliberately NOT called from inside a zustand
 * selector: it builds a new array every call, so `useLsp(s => s.problems())`
 * would fail the store's Object.is equality check on every render and loop
 * forever. Components select the `diagnostics` map (a stable reference) and
 * memoise this over it instead.
 */
export function buildProblems(
  diagnostics: Map<string, monaco.editor.IMarkerData[]>
): Problem[] {
  const out: Problem[] = []
  for (const [path, markers] of diagnostics) {
    for (const marker of markers) out.push({ path, marker })
  }
  // Errors first, then by file and line -- the order you want to work through.
  return out.sort((a, b) => {
    if (a.marker.severity !== b.marker.severity) return b.marker.severity - a.marker.severity
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    return a.marker.startLineNumber - b.marker.startLineNumber
  })
}

export const useLsp = create<LspState>((set, get) => ({
  servers: [],
  diagnostics: new Map(),

  setServers(servers) {
    set({ servers })
  },

  setDiagnostics(path, markers) {
    set((state) => {
      const next = new Map(state.diagnostics)
      if (markers.length === 0) next.delete(path)
      else next.set(path, markers)
      return { diagnostics: next }
    })
  },

  clearDiagnostics(path) {
    set((state) => {
      const next = new Map(state.diagnostics)
      next.delete(path)
      return { diagnostics: next }
    })
  },

  problems() {
    return buildProblems(get().diagnostics)
  },

  counts() {
    let errors = 0
    let warnings = 0
    for (const markers of get().diagnostics.values()) {
      for (const marker of markers) {
        // MarkerSeverity: Error = 8, Warning = 4.
        if (marker.severity === 8) errors++
        else if (marker.severity === 4) warnings++
      }
    }
    return { errors, warnings }
  }
}))
