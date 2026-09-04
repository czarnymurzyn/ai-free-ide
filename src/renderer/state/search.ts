/**
 * Project-wide search state.
 *
 * Results stream in from the main process, so this store appends batches as
 * they arrive rather than waiting for the whole search.
 */

import { create } from 'zustand'
import type { SearchFileResult, SearchQuery } from '@shared/types.js'

interface SearchState {
  pattern: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
  includeGlob: string
  excludeGlob: string

  results: SearchFileResult[]
  running: boolean
  searchId: string | null
  summary: { files: number; matches: number; truncated: boolean } | null
  error: string | null

  setPattern(pattern: string): void
  setReplacement(replacement: string): void
  toggle(flag: 'caseSensitive' | 'wholeWord' | 'isRegex'): void
  setGlob(which: 'includeGlob' | 'excludeGlob', value: string): void
  run(): Promise<void>
  cancel(): Promise<void>
  appendResults(searchId: string, batch: SearchFileResult[]): void
  finish(searchId: string, summary: { files: number; matches: number; truncated: boolean }): void
  replaceInFile(path: string): Promise<void>
  replaceAll(): Promise<void>
  clear(): void
}

export const useSearch = create<SearchState>((set, get) => ({
  pattern: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  isRegex: false,
  includeGlob: '',
  excludeGlob: '',

  results: [],
  running: false,
  searchId: null,
  summary: null,
  error: null,

  setPattern(pattern) {
    set({ pattern })
  },

  setReplacement(replacement) {
    set({ replacement })
  },

  toggle(flag) {
    set((state) => ({ [flag]: !state[flag] }) as Partial<SearchState>)
    if (get().pattern) void get().run()
  },

  setGlob(which, value) {
    set({ [which]: value } as Partial<SearchState>)
  },

  async run() {
    const state = get()
    if (!state.pattern) {
      set({ results: [], summary: null, running: false })
      return
    }

    // Supersede an in-flight search rather than racing it.
    if (state.searchId) await window.ide.search.cancel(state.searchId)

    set({ results: [], summary: null, running: true, error: null })
    try {
      const { searchId } = await window.ide.search.run(buildQuery(state))
      set({ searchId })
    } catch (err) {
      set({ running: false, error: (err as Error).message })
    }
  },

  async cancel() {
    const { searchId } = get()
    if (searchId) await window.ide.search.cancel(searchId)
    set({ running: false, searchId: null })
  },

  appendResults(searchId, batch) {
    // A late batch from a superseded search must not pollute the new results.
    if (get().searchId !== searchId) return
    set((state) => ({ results: [...state.results, ...batch] }))
  },

  finish(searchId, summary) {
    if (get().searchId !== searchId) return
    set({ running: false, summary })
  },

  async replaceInFile(path) {
    const state = get()
    if (!state.replacement && !state.pattern) return
    await window.ide.search.replace(path, buildQuery(state), state.replacement)
    set({ results: state.results.filter((r) => r.path !== path) })
  },

  async replaceAll() {
    const state = get()
    const paths = state.results.map((r) => r.path)
    for (const path of paths) {
      await window.ide.search.replace(path, buildQuery(state), state.replacement)
    }
    await get().run()
  },

  clear() {
    set({ pattern: '', results: [], summary: null, searchId: null, error: null })
  }
}))

function buildQuery(state: SearchState): SearchQuery {
  return {
    pattern: state.pattern,
    cwd: '', // filled in by the main process from the open workspace
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    isRegex: state.isRegex,
    ...(state.includeGlob ? { includeGlob: state.includeGlob } : {}),
    ...(state.excludeGlob ? { excludeGlob: state.excludeGlob } : {}),
    maxResults: 5000
  }
}
