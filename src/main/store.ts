/**
 * Settings and session persistence.
 *
 * Both live as plain JSON under app.getPath('userData'), which on Linux is
 * ~/.config/ai-free-ide. Settings are user-editable in a text editor -- the
 * IDE opens the same file through its own Settings command -- so reads are
 * tolerant of a malformed file rather than crashing the app.
 */

import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SessionState, Settings } from '../shared/types.js'

export const DEFAULT_SETTINGS: Settings = {
  'editor.fontFamily':
    "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
  'editor.fontSize': 13,
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off',
  'editor.minimap': true,
  'editor.renderWhitespace': 'boundary',
  'editor.formatOnSave': false,
  'workbench.theme': 'ide-dark',
  'terminal.fontSize': 13,
  'terminal.shell': null,
  'files.excludeGlobs': [
    '**/.git/**',
    '**/node_modules/**',
    '**/.venv/**',
    '**/venv/**',
    '**/__pycache__/**',
    '**/target/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.next/**',
    '**/.cache/**'
  ],
  'lsp.serverPaths': {}
}

const DEFAULT_SESSION: SessionState = {
  workspaceRoot: null,
  openFiles: [],
  activeFile: null,
  secondGroupFiles: [],
  secondGroupActive: null
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function sessionFile(): string {
  return join(app.getPath('userData'), 'session.json')
}

/**
 * Write via a temporary file and rename, so an interrupted write (or a full
 * disk) cannot leave a truncated settings file behind.
 */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return fallback
    return parsed as T
  } catch {
    // Missing file on first run, or a syntax error the user is mid-way through
    // typing. Either way, defaults are the right answer.
    return fallback
  }
}

let cachedSettings: Settings | null = null

export async function getSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings
  const stored = await readJson<Partial<Settings>>(settingsFile(), {})
  cachedSettings = { ...DEFAULT_SETTINGS, ...stored }
  return cachedSettings
}

export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = { ...current, ...partial }
  cachedSettings = next
  await writeJsonAtomic(settingsFile(), next)
  return next
}

/** Drop the cache so the next read picks up an external edit to settings.json. */
export function invalidateSettingsCache(): void {
  cachedSettings = null
}

export function getSettingsPath(): string {
  return settingsFile()
}

export async function getSession(): Promise<SessionState> {
  const stored = await readJson<Partial<SessionState>>(sessionFile(), {})
  return { ...DEFAULT_SESSION, ...stored }
}

export async function setSession(state: SessionState): Promise<void> {
  await writeJsonAtomic(sessionFile(), state)
}
