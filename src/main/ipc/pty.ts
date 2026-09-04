/**
 * Integrated terminal backend.
 *
 * Each terminal in the UI is a real PTY running the user's login shell, so
 * curses programs (htop, vim, less) behave exactly as they do in a normal
 * terminal emulator. Output is streamed to the renderer in small batches.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { EV, CH } from '../../shared/ipc-contract.js'
import type { PtySession, PtySpawnOptions } from '../../shared/types.js'
import { getSettings } from '../store.js'
import { assertInsideWorkspace } from '../workspace/root.js'

interface Session {
  id: string
  proc: pty.IPty
  /** Buffered output, flushed on a timer to avoid an IPC message per keystroke. */
  buffer: string
  flushTimer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()

/** Batch window for terminal output. 8ms keeps typing responsive. */
const FLUSH_MS = 8

/** Cap a single flush so a `cat` of a huge file cannot wedge the renderer. */
const MAX_CHUNK = 512 * 1024

export function registerPtyHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CH.ptySpawn, async (_e, opts: PtySpawnOptions): Promise<PtySession> => {
    const cwd = assertInsideWorkspace(opts.cwd)
    const shell = await resolveShell(opts.shell)
    const id = randomUUID()

    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cwd,
      cols: Math.max(1, opts.cols),
      rows: Math.max(1, opts.rows),
      env: buildEnv()
    })

    const session: Session = { id, proc, buffer: '', flushTimer: null }
    sessions.set(id, session)

    proc.onData((data) => {
      session.buffer += data
      if (session.flushTimer) return
      session.flushTimer = setTimeout(() => {
        session.flushTimer = null
        flush(session, getWindow)
      }, FLUSH_MS)
    })

    proc.onExit(({ exitCode }) => {
      flush(session, getWindow)
      sessions.delete(id)
      getWindow()?.webContents.send(EV.ptyExit, id, exitCode)
    })

    return { id, pid: proc.pid, shell }
  })

  ipcMain.handle(CH.ptyWrite, async (_e, id: string, data: string) => {
    sessions.get(id)?.proc.write(data)
  })

  ipcMain.handle(CH.ptyResize, async (_e, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session) return
    try {
      session.proc.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      // The process can exit between the renderer measuring and this call.
    }
  })

  ipcMain.handle(CH.ptyKill, async (_e, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    try {
      session.proc.kill()
    } catch {
      /* already gone */
    }
    sessions.delete(id)
  })
}

function flush(session: Session, getWindow: () => BrowserWindow | null): void {
  if (session.buffer.length === 0) return

  let chunk = session.buffer
  if (chunk.length > MAX_CHUNK) {
    // Keep the tail: the end of a large dump is what the user wants to see.
    chunk = chunk.slice(chunk.length - MAX_CHUNK)
  }
  session.buffer = ''
  getWindow()?.webContents.send(EV.ptyData, session.id, chunk)
}

/**
 * Terminal environment.
 *
 * Inherits the user's environment so their PATH, aliases and tooling work,
 * with TERM set for 256-colour support and Electron's own variables removed
 * so a program launched from the terminal does not think it is inside Electron.
 */
function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'ai-free-ide'
  return env
}

async function resolveShell(requested?: string): Promise<string> {
  const settings = await getSettings()
  const candidates = [
    requested,
    settings['terminal.shell'] ?? undefined,
    process.env.SHELL,
    '/bin/bash',
    '/bin/sh'
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return '/bin/sh'
}

/** Kill every terminal on shutdown so no orphaned shells survive the app. */
export function disposeAllPtys(): void {
  for (const session of sessions.values()) {
    try {
      session.proc.kill()
    } catch {
      /* ignore */
    }
  }
  sessions.clear()
}
