/**
 * Project-wide search.
 *
 * Drives the system `ripgrep` with `--json`, which gives exact byte offsets
 * and handles .gitignore, binary detection and encoding for us. Results are
 * streamed to the renderer as they arrive so a search across a large tree
 * fills in progressively instead of blocking.
 *
 * When rg is not installed, a Node walker provides the same results more
 * slowly -- the IDE never asks the user to install anything, and never
 * downloads a binary.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { CH, EV } from '../../shared/ipc-contract.js'
import { isProbablyBinary } from '../../shared/languages.js'
import type { SearchFileResult, SearchMatch, SearchQuery } from '../../shared/types.js'
import { assertInsideWorkspaceReal, getWorkspaceRoot } from '../workspace/root.js'

/** Longest preview line sent to the UI; long minified lines are truncated. */
const MAX_PREVIEW = 400

const running = new Map<string, ChildProcessWithoutNullStreams | { kill(): void }>()

export function registerSearchHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CH.searchRun, async (_e, query: SearchQuery) => {
    const searchId = randomUUID()
    const root = getWorkspaceRoot()
    if (!root) throw new Error('No workspace is open')

    // Deliberately not awaited: results stream over EV.searchResults.
    void runSearch(searchId, { ...query, cwd: root }, getWindow)
    return { searchId }
  })

  ipcMain.handle(CH.searchCancel, async (_e, searchId: string) => {
    running.get(searchId)?.kill()
    running.delete(searchId)
  })

  ipcMain.handle(
    CH.searchReplace,
    async (_e, path: string, query: SearchQuery, replacement: string) => {
      const target = await assertInsideWorkspaceReal(path)
      const original = await readFile(target, 'utf8')
      const re = buildRegExp(query, true)

      let replacements = 0
      const updated = original.replace(re, (...args) => {
        replacements++
        // For a literal (non-regex) search, `replacement` is used verbatim so
        // characters like `$&` are not interpreted as capture references.
        if (!query.isRegex) return replacement
        return expandReplacement(replacement, args)
      })

      if (replacements > 0) await writeFile(target, updated, 'utf8')
      return { replacements }
    }
  )
}

async function runSearch(
  searchId: string,
  query: SearchQuery,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  const send = (results: SearchFileResult[]): void => {
    if (results.length > 0) getWindow()?.webContents.send(EV.searchResults, searchId, results)
  }
  const done = (files: number, matches: number, truncated: boolean): void => {
    running.delete(searchId)
    getWindow()?.webContents.send(EV.searchDone, searchId, { files, matches, truncated })
  }

  if (await hasRipgrep()) {
    runRipgrep(searchId, query, send, done)
  } else {
    await runFallback(searchId, query, send, done)
  }
}

// ------------------------------------------------------------------ ripgrep

function buildRipgrepArgs(query: SearchQuery): string[] {
  const args = ['--json', '--hidden', '--glob', '!.git/*']

  if (!query.isRegex) args.push('--fixed-strings')
  if (query.caseSensitive) args.push('--case-sensitive')
  else args.push('--ignore-case')
  if (query.wholeWord) args.push('--word-regexp')
  if (query.includeGlob) args.push('--glob', query.includeGlob)
  if (query.excludeGlob) args.push('--glob', `!${query.excludeGlob}`)

  args.push('--max-count', '200', '--', query.pattern)
  return args
}

function runRipgrep(
  searchId: string,
  query: SearchQuery,
  send: (r: SearchFileResult[]) => void,
  done: (files: number, matches: number, truncated: boolean) => void
): void {
  const child = spawn('rg', buildRipgrepArgs(query), { cwd: query.cwd })
  running.set(searchId, child)

  let files = 0
  let matches = 0
  let truncated = false
  let pendingLine = ''
  let batch: SearchFileResult[] = []
  let current: SearchFileResult | null = null

  const flush = (): void => {
    if (batch.length === 0) return
    send(batch)
    batch = []
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    // rg emits one JSON object per line; a chunk can split a line in half.
    const lines = (pendingLine + chunk).split('\n')
    pendingLine = lines.pop() ?? ''

    for (const line of lines) {
      if (!line) continue
      let event: RgEvent
      try {
        event = JSON.parse(line) as RgEvent
      } catch {
        continue
      }

      if (event.type === 'begin') {
        current = { path: join(query.cwd, event.data.path.text ?? ''), matches: [] }
      } else if (event.type === 'match' && current) {
        if (matches >= query.maxResults) {
          truncated = true
          child.kill()
          break
        }
        const text = event.data.lines.text ?? ''
        for (const sub of event.data.submatches) {
          current.matches.push({
            line: event.data.line_number ?? 1,
            // rg reports byte offsets into the line; convert to a character
            // column so the editor highlights the right span in non-ASCII text.
            column: byteToCharOffset(text, sub.start) + 1,
            length: byteToCharOffset(text, sub.end) - byteToCharOffset(text, sub.start),
            preview: text.replace(/\r?\n$/, '').slice(0, MAX_PREVIEW)
          })
          matches++
        }
      } else if (event.type === 'end' && current) {
        if (current.matches.length > 0) {
          files++
          batch.push(current)
          if (batch.length >= 20) flush()
        }
        current = null
      }
    }
  })

  child.on('error', () => {
    flush()
    done(files, matches, truncated)
  })

  child.on('close', () => {
    flush()
    done(files, matches, truncated)
  })
}

interface RgEvent {
  type: 'begin' | 'match' | 'end' | 'summary'
  data: {
    path: { text?: string }
    lines: { text?: string }
    line_number?: number
    submatches: Array<{ start: number; end: number }>
  }
}

let ripgrepAvailable: boolean | null = null

async function hasRipgrep(): Promise<boolean> {
  if (ripgrepAvailable !== null) return ripgrepAvailable
  ripgrepAvailable = await new Promise<boolean>((resolve) => {
    const probe = spawn('rg', ['--version'])
    probe.on('error', () => resolve(false))
    probe.on('close', (code) => resolve(code === 0))
  })
  return ripgrepAvailable
}

/**
 * ripgrep's submatch offsets are byte offsets into the UTF-8 line. The editor
 * addresses columns by UTF-16 code unit, so a line containing multi-byte
 * characters needs converting or the highlight lands in the wrong place.
 */
export function byteToCharOffset(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0
  const buf = Buffer.from(text, 'utf8')
  if (byteOffset >= buf.length) return text.length
  return buf.subarray(0, byteOffset).toString('utf8').length
}

// ----------------------------------------------------------------- fallback

async function runFallback(
  searchId: string,
  query: SearchQuery,
  send: (r: SearchFileResult[]) => void,
  done: (files: number, matches: number, truncated: boolean) => void
): Promise<void> {
  let cancelled = false
  running.set(searchId, { kill: () => (cancelled = true) })

  const re = buildRegExp(query, true)
  let files = 0
  let matches = 0
  let truncated = false
  let batch: SearchFileResult[] = []

  const skip = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build', 'out'])
  const queue: string[] = [query.cwd]

  while (queue.length > 0 && !cancelled && !truncated) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (cancelled || truncated) break
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        queue.push(full)
        continue
      }
      if (!entry.isFile() || isProbablyBinary(full)) continue

      try {
        const info = await stat(full)
        if (info.size > 4 * 1024 * 1024) continue

        const text = await readFile(full, 'utf8')
        const fileMatches = matchesInText(text, re)
        if (fileMatches.length === 0) continue

        if (matches + fileMatches.length > query.maxResults) truncated = true
        const capped = fileMatches.slice(0, Math.max(0, query.maxResults - matches))
        if (capped.length === 0) break

        matches += capped.length
        files++
        batch.push({ path: full, matches: capped })
        if (batch.length >= 20) {
          send(batch)
          batch = []
        }
      } catch {
        continue
      }
    }
  }

  if (batch.length > 0) send(batch)
  running.delete(searchId)
  done(files, matches, truncated)
}

export function matchesInText(text: string, re: RegExp): SearchMatch[] {
  const out: SearchMatch[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out.push({
        line: i + 1,
        column: m.index + 1,
        length: m[0].length,
        preview: line.slice(0, MAX_PREVIEW)
      })
      // A zero-length match would spin forever without this.
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return out
}

export function buildRegExp(query: SearchQuery, global: boolean): RegExp {
  let source = query.isRegex ? query.pattern : escapeRegExp(query.pattern)
  if (query.wholeWord) source = `\\b(?:${source})\\b`
  const flags = `${global ? 'g' : ''}${query.caseSensitive ? '' : 'i'}`
  return new RegExp(source, flags)
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Expand $1/$& style references for a regex replace. */
function expandReplacement(replacement: string, args: unknown[]): string {
  const groups = args.slice(0, -2) as string[]
  return replacement.replace(/\$(\d|&)/g, (_, token: string) => {
    if (token === '&') return groups[0] ?? ''
    return groups[Number(token)] ?? ''
  })
}
