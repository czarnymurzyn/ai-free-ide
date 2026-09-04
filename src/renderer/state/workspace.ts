/**
 * Workspace root, the file tree, and the quick-open index.
 *
 * The tree is stored as a flat map keyed by absolute path with an explicit
 * `expanded` set, rather than a nested structure. Flat storage keeps updates
 * O(1) when the watcher reports a change deep in the tree, and avoids
 * rebuilding React elements for every ancestor of a changed file.
 */

import { create } from 'zustand'
import type { DirEntry } from '@shared/types.js'

interface WorkspaceState {
  root: string | null
  /** Directory path -> its children, for directories that have been read. */
  children: Map<string, DirEntry[]>
  expanded: Set<string>
  loading: Set<string>
  /** Workspace-relative paths, for quick-open. */
  fileIndex: string[]
  indexing: boolean

  open(root?: string): Promise<void>
  loadChildren(dir: string, force?: boolean): Promise<void>
  toggle(dir: string): Promise<void>
  expandTo(path: string): Promise<void>
  refresh(paths: string[]): Promise<void>
  refreshIndex(): Promise<void>
  scheduleIndexRefresh(): void
  reset(): void
}

/**
 * Rebuilding the quick-open index walks the whole tree, so it is debounced:
 * a build or an npm install in the terminal can produce thousands of watcher
 * events, and re-walking on each one would peg the main process.
 */
let indexTimer: ReturnType<typeof setTimeout> | null = null

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  children: new Map(),
  expanded: new Set(),
  loading: new Set(),
  fileIndex: [],
  indexing: false,

  async open(root) {
    const resolved = root ? await window.ide.workspace.open(root) : await window.ide.workspace.pick()
    if (!resolved) return

    set({
      root: resolved,
      children: new Map(),
      expanded: new Set([resolved]),
      loading: new Set()
    })
    await get().loadChildren(resolved)
    void get().refreshIndex()
  },

  async loadChildren(dir, force = false) {
    const { children, loading } = get()
    if (!force && children.has(dir)) return
    if (loading.has(dir)) return

    set({ loading: new Set(loading).add(dir) })
    try {
      const entries = await window.ide.fs.list(dir)
      const next = new Map(get().children)
      next.set(dir, entries)
      set({ children: next })
    } catch {
      // Unreadable directory: leave it collapsed rather than surfacing a
      // modal for something the user can see in the tree anyway.
      const next = new Map(get().children)
      next.set(dir, [])
      set({ children: next })
    } finally {
      const stillLoading = new Set(get().loading)
      stillLoading.delete(dir)
      set({ loading: stillLoading })
    }
  },

  async toggle(dir) {
    const expanded = new Set(get().expanded)
    if (expanded.has(dir)) {
      expanded.delete(dir)
      set({ expanded })
      return
    }
    expanded.add(dir)
    set({ expanded })
    await get().loadChildren(dir)
  },

  /** Expand every ancestor of a path so the file becomes visible in the tree. */
  async expandTo(path) {
    const root = get().root
    if (!root || !path.startsWith(root)) return

    const segments = path.slice(root.length).split('/').filter(Boolean)
    let current = root
    // The last segment is the file itself, which has no children to load.
    for (const segment of segments.slice(0, -1)) {
      current = `${current}/${segment}`
      const expanded = new Set(get().expanded)
      expanded.add(current)
      set({ expanded })
      await get().loadChildren(current)
    }
  },

  /**
   * Re-read the directories containing the changed paths. Only directories
   * already loaded are refreshed -- there is no point reading one the user has
   * never expanded.
   */
  async refresh(paths) {
    const { children } = get()
    const dirs = new Set<string>()
    for (const path of paths) {
      const dir = path.slice(0, path.lastIndexOf('/')) || '/'
      if (children.has(dir)) dirs.add(dir)
      // A change to a directory itself also affects its own listing.
      if (children.has(path)) dirs.add(path)
    }
    await Promise.all([...dirs].map((dir) => get().loadChildren(dir, true)))
  },

  async refreshIndex() {
    set({ indexing: true })
    try {
      set({ fileIndex: await window.ide.fs.index() })
    } finally {
      set({ indexing: false })
    }
  },

  /**
   * Keep quick-open honest after files appear or disappear on disk. Without
   * this, a file you just created is not findable with Ctrl+P until restart.
   */
  scheduleIndexRefresh() {
    if (indexTimer) clearTimeout(indexTimer)
    indexTimer = setTimeout(() => {
      indexTimer = null
      void get().refreshIndex()
    }, 400)
  },

  reset() {
    set({
      root: null,
      children: new Map(),
      expanded: new Set(),
      loading: new Set(),
      fileIndex: []
    })
  }
}))
