/**
 * File-system operations available to the renderer.
 *
 * Every handler resolves its path through the workspace jail in
 * ../workspace/root.ts before touching the disk.
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { constants } from 'node:fs'
import { access, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { CH } from '../../shared/ipc-contract.js'
import { isProbablyBinary, languageIdFor } from '../../shared/languages.js'
import type { DirEntry, FileContent, WriteResult } from '../../shared/types.js'
import { getSettings } from '../store.js'
import {
  assertInsideWorkspace,
  assertInsideWorkspaceReal,
  getWorkspaceRoot,
  setWorkspaceRoot
} from '../workspace/root.js'
import { startWatching, stopWatching } from '../workspace/watcher.js'

/** Refuse to load anything large enough to lock up the editor. */
const MAX_FILE_BYTES = 16 * 1024 * 1024

/** Directory names skipped when indexing, regardless of settings. */
const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.cache'])

export function registerFsHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CH.workspacePick, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openWorkspace(result.filePaths[0]!, getWindow)
  })

  ipcMain.handle(CH.workspaceOpen, async (_e, root: string) => openWorkspace(root, getWindow))

  ipcMain.handle(CH.workspaceRoot, async () => getWorkspaceRoot())

  ipcMain.handle(CH.fsList, async (_e, dir: string): Promise<DirEntry[]> => {
    const target = await assertInsideWorkspaceReal(dir)
    const entries = await readdir(target, { withFileTypes: true })

    const out: DirEntry[] = []
    for (const entry of entries) {
      const full = join(target, entry.name)
      let kind: DirEntry['kind'] = 'file'
      let size: number | undefined
      let mtimeMs = 0

      try {
        if (entry.isSymbolicLink()) {
          // Resolve the target so the tree can show a symlinked directory as
          // expandable, and a symlinked file with its real size.
          const resolved = await stat(full)
          kind = resolved.isDirectory() ? 'directory' : 'symlink'
          mtimeMs = resolved.mtimeMs
          if (!resolved.isDirectory()) size = resolved.size
        } else if (entry.isDirectory()) {
          kind = 'directory'
          mtimeMs = (await stat(full)).mtimeMs
        } else {
          const info = await stat(full)
          size = info.size
          mtimeMs = info.mtimeMs
        }
      } catch {
        // Broken symlink or a permission error: list it, but do not fail the
        // whole directory because of one bad entry.
        kind = entry.isDirectory() ? 'directory' : 'file'
      }

      out.push({ name: entry.name, path: full, kind, size, mtimeMs })
    }

    // Directories first, then case-insensitive by name -- the ordering every
    // file manager and IDE uses.
    out.sort((a, b) => {
      const aDir = a.kind === 'directory'
      const bDir = b.kind === 'directory'
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return out
  })

  ipcMain.handle(CH.fsRead, async (_e, path: string): Promise<FileContent> => {
    const target = await assertInsideWorkspaceReal(path)
    const info = await stat(target)

    if (info.isDirectory()) throw new Error(`Cannot open a directory: ${basename(target)}`)
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `File is too large to open (${(info.size / 1024 / 1024).toFixed(1)} MB, limit ${MAX_FILE_BYTES / 1024 / 1024} MB)`
      )
    }
    if (isProbablyBinary(target) || (await looksBinary(target))) {
      throw new Error(`Cannot open a binary file: ${basename(target)}`)
    }

    const buf = await readFile(target)
    let text = buf.toString('utf8')

    // Normalise to \n in the model and remember the original ending, so a file
    // written on Windows round-trips unchanged.
    const eol: FileContent['eol'] = text.includes('\r\n') ? '\r\n' : '\n'
    if (eol === '\r\n') text = text.replaceAll('\r\n', '\n')

    return { path: target, text, eol, mtimeMs: info.mtimeMs, languageId: languageIdFor(target) }
  })

  ipcMain.handle(
    CH.fsWrite,
    async (_e, path: string, text: string, expectedMtimeMs?: number): Promise<WriteResult> => {
      const target = await assertInsideWorkspaceReal(path)

      // Detect the file changing underneath an open editor. The renderer
      // passes the mtime it last read; a mismatch means someone else wrote.
      if (typeof expectedMtimeMs === 'number' && expectedMtimeMs > 0) {
        try {
          const current = await stat(target)
          if (Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
            throw new Error(
              `${basename(target)} changed on disk since it was opened. Reload the file, or use Save As.`
            )
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
      }

      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, text, 'utf8')
      const info = await stat(target)
      return { path: target, mtimeMs: info.mtimeMs }
    }
  )

  ipcMain.handle(CH.fsCreate, async (_e, path: string, kind: 'file' | 'directory') => {
    const target = assertInsideWorkspace(path)
    if (await exists(target)) throw new Error(`Already exists: ${basename(target)}`)

    if (kind === 'directory') {
      await mkdir(target, { recursive: true })
    } else {
      await mkdir(dirname(target), { recursive: true })
      // wx fails if the path appeared between the check above and here.
      const handle = await open(target, 'wx')
      await handle.close()
    }
  })

  ipcMain.handle(CH.fsRename, async (_e, from: string, to: string) => {
    const src = await assertInsideWorkspaceReal(from)
    const dst = assertInsideWorkspace(to)
    if (await exists(dst)) throw new Error(`Already exists: ${basename(dst)}`)
    await mkdir(dirname(dst), { recursive: true })
    await rename(src, dst)
  })

  ipcMain.handle(CH.fsDelete, async (_e, path: string) => {
    const target = await assertInsideWorkspaceReal(path)
    if (target === getWorkspaceRoot()) throw new Error('Refusing to delete the workspace root')
    // Goes to the desktop trash rather than being unlinked, so a misclick in
    // the file tree is recoverable.
    await shell.trashItem(target)
  })

  ipcMain.handle(CH.fsIndex, async (): Promise<string[]> => {
    const root = getWorkspaceRoot()
    if (!root) return []
    const settings = await getSettings()
    const extraSkips = new Set(
      settings['files.excludeGlobs']
        .map((g) => g.replace(/^\*\*\//, '').replace(/\/\*\*$/, ''))
        .filter((g) => !g.includes('*') && !g.includes('/'))
    )
    return indexFiles(root, extraSkips)
  })

  ipcMain.handle(CH.fsRevealInFileManager, async (_e, path: string) => {
    const target = await assertInsideWorkspaceReal(path)
    shell.showItemInFolder(target)
  })

  ipcMain.handle(CH.fsSaveAsPath, async (_e, suggestedName: string) => {
    const win = getWindow()
    const root = getWorkspaceRoot()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save As',
      defaultPath: root ? join(root, suggestedName) : suggestedName
    })
    return result.canceled || !result.filePath ? null : result.filePath
  })
}

async function openWorkspace(
  root: string,
  getWindow: () => BrowserWindow | null
): Promise<string | null> {
  stopWatching()
  const resolved = await setWorkspaceRoot(root)
  startWatching(resolved, (events) => {
    getWindow()?.webContents.send('ide:watch:events', events)
  })
  return resolved
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Heuristic used by every text editor: a NUL byte in the first few KB means
 * this is not text. Catches extensionless binaries the extension list misses.
 */
async function looksBinary(path: string): Promise<boolean> {
  let handle
  try {
    handle = await open(path, 'r')
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

/**
 * Breadth-first walk producing workspace-relative paths for quick-open.
 *
 * Capped at 50k files: past that the quick-open list is not useful anyway, and
 * an unbounded walk on a home directory would stall the main process.
 */
async function indexFiles(root: string, extraSkips: Set<string>): Promise<string[]> {
  const out: string[] = []
  const queue: string[] = [root]
  const limit = 50_000

  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable directory; skip it rather than abort the index
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        if (ALWAYS_SKIP.has(entry.name) || entry.isDirectory()) continue
      }
      if (ALWAYS_SKIP.has(entry.name) || extraSkips.has(entry.name)) continue

      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else if (entry.isFile()) {
        out.push(relative(root, full))
        if (out.length >= limit) break
      }
    }
  }
  return out
}
