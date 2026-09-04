/**
 * The preload bridge.
 *
 * This runs in a sandboxed context with contextIsolation on, so it may use
 * only `contextBridge` and `ipcRenderer`. It deliberately exposes a small,
 * named API rather than `ipcRenderer` itself -- handing the renderer a raw
 * `invoke` would let any renderer-side bug call any channel.
 *
 * Every subscription helper returns an unsubscribe function, because a React
 * effect that cannot clean up leaks a listener on every re-render.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, EV, type AppInfo, type CommitOptions, type IdeApi } from '../shared/ipc-contract.js'
import type {
  DirEntry,
  FileContent,
  GitBranch,
  GitCommit,
  GitHunk,
  GitStatus,
  LanguageServerStatus,
  PtySession,
  PtySpawnOptions,
  SearchFileResult,
  SearchQuery,
  SessionState,
  Settings,
  WatchEvent,
  WriteResult
} from '../shared/types.js'

/** Subscribe to a push channel and return an unsubscribe function. */
function on<A extends unknown[]>(
  channel: string,
  cb: (...args: A) => void
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: IdeApi = {
  app: {
    info: () => ipcRenderer.invoke(CH.appInfo) as Promise<AppInfo>
  },

  workspace: {
    pick: () => ipcRenderer.invoke(CH.workspacePick) as Promise<string | null>,
    open: (root) => ipcRenderer.invoke(CH.workspaceOpen, root) as Promise<string | null>,
    root: () => ipcRenderer.invoke(CH.workspaceRoot) as Promise<string | null>,
    onFileEvents: (cb) => on<[WatchEvent[]]>(EV.watchEvents, cb)
  },

  fs: {
    list: (dir) => ipcRenderer.invoke(CH.fsList, dir) as Promise<DirEntry[]>,
    read: (path) => ipcRenderer.invoke(CH.fsRead, path) as Promise<FileContent>,
    write: (path, text, expectedMtimeMs) =>
      ipcRenderer.invoke(CH.fsWrite, path, text, expectedMtimeMs) as Promise<WriteResult>,
    create: (path, kind) => ipcRenderer.invoke(CH.fsCreate, path, kind) as Promise<void>,
    rename: (from, to) => ipcRenderer.invoke(CH.fsRename, from, to) as Promise<void>,
    remove: (path) => ipcRenderer.invoke(CH.fsDelete, path) as Promise<void>,
    index: () => ipcRenderer.invoke(CH.fsIndex) as Promise<string[]>,
    reveal: (path) => ipcRenderer.invoke(CH.fsRevealInFileManager, path) as Promise<void>,
    saveAsPath: (name) => ipcRenderer.invoke(CH.fsSaveAsPath, name) as Promise<string | null>
  },

  pty: {
    spawn: (opts: PtySpawnOptions) => ipcRenderer.invoke(CH.ptySpawn, opts) as Promise<PtySession>,
    write: (id, data) => ipcRenderer.invoke(CH.ptyWrite, id, data) as Promise<void>,
    resize: (id, cols, rows) => ipcRenderer.invoke(CH.ptyResize, id, cols, rows) as Promise<void>,
    kill: (id) => ipcRenderer.invoke(CH.ptyKill, id) as Promise<void>,
    onData: (cb) => on<[string, string]>(EV.ptyData, cb),
    onExit: (cb) => on<[string, number]>(EV.ptyExit, cb)
  },

  search: {
    run: (query: SearchQuery) =>
      ipcRenderer.invoke(CH.searchRun, query) as Promise<{ searchId: string }>,
    cancel: (searchId) => ipcRenderer.invoke(CH.searchCancel, searchId) as Promise<void>,
    replace: (path, query, replacement) =>
      ipcRenderer.invoke(CH.searchReplace, path, query, replacement) as Promise<{
        replacements: number
      }>,
    onResults: (cb) => on<[string, SearchFileResult[]]>(EV.searchResults, cb),
    onDone: (cb) =>
      on<[string, { files: number; matches: number; truncated: boolean }]>(EV.searchDone, cb)
  },

  git: {
    status: () => ipcRenderer.invoke(CH.gitStatus) as Promise<GitStatus>,
    diff: (path, staged) => ipcRenderer.invoke(CH.gitDiff, path, staged) as Promise<string>,
    hunks: (path) => ipcRenderer.invoke(CH.gitHunks, path) as Promise<GitHunk[]>,
    fileAtHead: (path) => ipcRenderer.invoke(CH.gitFileAtHead, path) as Promise<string | null>,
    stage: (paths) => ipcRenderer.invoke(CH.gitStage, paths) as Promise<void>,
    unstage: (paths) => ipcRenderer.invoke(CH.gitUnstage, paths) as Promise<void>,
    discard: (paths) => ipcRenderer.invoke(CH.gitDiscard, paths) as Promise<void>,
    commit: (opts: CommitOptions) =>
      ipcRenderer.invoke(CH.gitCommit, opts) as Promise<{ hash: string }>,
    branches: () => ipcRenderer.invoke(CH.gitBranches) as Promise<GitBranch[]>,
    checkout: (name) => ipcRenderer.invoke(CH.gitCheckout, name) as Promise<void>,
    createBranch: (name, checkout) =>
      ipcRenderer.invoke(CH.gitCreateBranch, name, checkout) as Promise<void>,
    log: (limit) => ipcRenderer.invoke(CH.gitLog, limit) as Promise<GitCommit[]>,
    stash: (action) => ipcRenderer.invoke(CH.gitStash, action) as Promise<string>,
    onChanged: (cb) => on<[]>(EV.gitChanged, cb)
  },

  lsp: {
    status: () => ipcRenderer.invoke(CH.lspStatus) as Promise<LanguageServerStatus[]>,
    didOpen: (path, languageId, version, text) =>
      ipcRenderer.invoke(CH.lspDidOpen, path, languageId, version, text) as Promise<void>,
    didChange: (path, version, text) =>
      ipcRenderer.invoke(CH.lspDidChange, path, version, text) as Promise<void>,
    didClose: (path) => ipcRenderer.invoke(CH.lspDidClose, path) as Promise<void>,
    didSave: (path, text) => ipcRenderer.invoke(CH.lspDidSave, path, text) as Promise<void>,
    request: (path, method, params) =>
      ipcRenderer.invoke(CH.lspRequest, path, method, params) as Promise<never>,
    restart: (serverId) => ipcRenderer.invoke(CH.lspRestart, serverId) as Promise<void>,
    onDiagnostics: (cb) => on<[string, unknown[]]>(EV.lspDiagnostics, cb),
    onStatusChanged: (cb) => on<[LanguageServerStatus[]]>(EV.lspStatusChanged, cb)
  },

  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet) as Promise<Settings>,
    set: (partial) => ipcRenderer.invoke(CH.settingsSet, partial) as Promise<Settings>,
    path: () => ipcRenderer.invoke(CH.settingsPath) as Promise<string>
  },

  session: {
    get: () => ipcRenderer.invoke(CH.sessionGet) as Promise<SessionState>,
    set: (state) => ipcRenderer.invoke(CH.sessionSet, state) as Promise<void>
  },

  menu: {
    onCommand: (cb) => on<[string]>(EV.menuCommand, cb)
  }
}

contextBridge.exposeInMainWorld('ide', api)
