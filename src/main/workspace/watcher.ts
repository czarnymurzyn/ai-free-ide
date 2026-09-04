/**
 * Workspace file watcher.
 *
 * fs.watch with `recursive: true` uses inotify on Linux, which is cheap but
 * fires several events for one logical change (and fires constantly for build
 * output). Events are therefore filtered and coalesced before being sent to
 * the renderer, so a `npm run build` in the integrated terminal does not flood
 * the UI with thousands of tree refreshes.
 */

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { WatchEvent } from '../../shared/types.js'

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '.idea',
  '.svelte-kit'
])

/** Editor and tool scratch files that should never reach the UI. */
const IGNORED_SUFFIXES = ['~', '.swp', '.swx', '.tmp', '.lock']

const DEBOUNCE_MS = 120

let watcher: FSWatcher | null = null
let pending = new Map<string, WatchEvent>()
let timer: NodeJS.Timeout | null = null

export function startWatching(root: string, onEvents: (events: WatchEvent[]) => void): void {
  stopWatching()

  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_type, filename) => {
      if (!filename) return
      const rel = filename.toString()
      if (shouldIgnore(rel)) return

      const full = join(root, rel)
      queue(full, onEvents)
    })
  } catch (err) {
    // Hitting the inotify watch limit is the common failure here. The IDE is
    // fully usable without live tree updates, so degrade rather than fail.
    console.warn('[watcher] disabled:', (err as Error).message)
    watcher = null
  }
}

export function stopWatching(): void {
  watcher?.close()
  watcher = null
  if (timer) clearTimeout(timer)
  timer = null
  pending.clear()
}

export function shouldIgnore(relativePath: string): boolean {
  for (const segment of relativePath.split(sep)) {
    if (IGNORED_SEGMENTS.has(segment)) return true
  }
  const base = relativePath.split(sep).pop() ?? ''
  if (base.startsWith('.#')) return true // emacs lock files
  return IGNORED_SUFFIXES.some((suffix) => base.endsWith(suffix))
}

function queue(path: string, onEvents: (events: WatchEvent[]) => void): void {
  // A later event for the same path supersedes an earlier one.
  pending.set(path, { type: 'changed', path })

  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const batch = [...pending.values()]
    pending = new Map()
    void resolveKinds(batch).then((events) => {
      if (events.length > 0) onEvents(events)
    })
  }, DEBOUNCE_MS)
}

/**
 * inotify tells us a path changed but not whether it now exists. One stat per
 * changed path resolves created/changed vs deleted for the renderer.
 */
async function resolveKinds(batch: WatchEvent[]): Promise<WatchEvent[]> {
  return Promise.all(
    batch.map(async (event): Promise<WatchEvent> => {
      try {
        await stat(event.path)
        return { type: 'changed', path: event.path }
      } catch {
        return { type: 'deleted', path: event.path }
      }
    })
  )
}
