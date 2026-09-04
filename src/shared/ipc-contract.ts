/**
 * The complete main <-> renderer surface, in one place.
 *
 * The renderer has no Node access; everything it can do to the machine passes
 * through these channels and is validated on the main side. Keeping the list
 * here (rather than scattering string literals) makes the whole privileged
 * surface auditable at a glance -- which matters for a project whose main
 * promise is about what it cannot do.
 */

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
} from './types.js'

/** Request/response channels, invoked with ipcRenderer.invoke. */
export const CH = {
  // workspace + files
  workspacePick: 'ide:workspace:pick',
  workspaceOpen: 'ide:workspace:open',
  workspaceRoot: 'ide:workspace:root',
  fsList: 'ide:fs:list',
  fsRead: 'ide:fs:read',
  fsWrite: 'ide:fs:write',
  fsCreate: 'ide:fs:create',
  fsRename: 'ide:fs:rename',
  fsDelete: 'ide:fs:delete',
  fsIndex: 'ide:fs:index',
  fsRevealInFileManager: 'ide:fs:reveal',
  fsSaveAsPath: 'ide:fs:saveAsPath',

  // terminal
  ptySpawn: 'ide:pty:spawn',
  ptyWrite: 'ide:pty:write',
  ptyResize: 'ide:pty:resize',
  ptyKill: 'ide:pty:kill',

  // search
  searchRun: 'ide:search:run',
  searchCancel: 'ide:search:cancel',
  searchReplace: 'ide:search:replace',

  // git
  gitStatus: 'ide:git:status',
  gitDiff: 'ide:git:diff',
  gitHunks: 'ide:git:hunks',
  gitFileAtHead: 'ide:git:fileAtHead',
  gitStage: 'ide:git:stage',
  gitUnstage: 'ide:git:unstage',
  gitDiscard: 'ide:git:discard',
  gitCommit: 'ide:git:commit',
  gitBranches: 'ide:git:branches',
  gitCheckout: 'ide:git:checkout',
  gitCreateBranch: 'ide:git:createBranch',
  gitLog: 'ide:git:log',
  gitStash: 'ide:git:stash',

  // language servers
  lspStatus: 'ide:lsp:status',
  lspDidOpen: 'ide:lsp:didOpen',
  lspDidChange: 'ide:lsp:didChange',
  lspDidClose: 'ide:lsp:didClose',
  lspDidSave: 'ide:lsp:didSave',
  lspRequest: 'ide:lsp:request',
  lspRestart: 'ide:lsp:restart',

  // settings + session
  settingsGet: 'ide:settings:get',
  settingsSet: 'ide:settings:set',
  settingsPath: 'ide:settings:path',
  sessionGet: 'ide:session:get',
  sessionSet: 'ide:session:set',

  // misc
  appInfo: 'ide:app:info'
} as const

/** Push channels, main -> renderer. */
export const EV = {
  ptyData: 'ide:pty:data',
  ptyExit: 'ide:pty:exit',
  watchEvents: 'ide:watch:events',
  searchResults: 'ide:search:results',
  searchDone: 'ide:search:done',
  lspDiagnostics: 'ide:lsp:diagnostics',
  lspStatusChanged: 'ide:lsp:statusChanged',
  gitChanged: 'ide:git:changed',
  menuCommand: 'ide:menu:command'
} as const

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** Always true. Present so the UI can assert the guarantee it advertises. */
  offline: true
}

export interface CommitOptions {
  message: string
  amend: boolean
  /** Stage every tracked modification before committing. */
  all: boolean
}

/**
 * The object exposed on `window.ide` by the preload script.
 * Every method is asynchronous and crosses the process boundary.
 */
export interface IdeApi {
  app: {
    info(): Promise<AppInfo>
  }

  workspace: {
    pick(): Promise<string | null>
    open(root: string): Promise<string | null>
    root(): Promise<string | null>
    onFileEvents(cb: (events: WatchEvent[]) => void): () => void
  }

  fs: {
    list(dir: string): Promise<DirEntry[]>
    read(path: string): Promise<FileContent>
    write(path: string, text: string, expectedMtimeMs?: number): Promise<WriteResult>
    create(path: string, kind: 'file' | 'directory'): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
    /** Flat list of workspace-relative file paths, for quick-open. */
    index(): Promise<string[]>
    reveal(path: string): Promise<void>
    saveAsPath(suggestedName: string): Promise<string | null>
  }

  pty: {
    spawn(opts: PtySpawnOptions): Promise<PtySession>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
  }

  search: {
    run(query: SearchQuery): Promise<{ searchId: string }>
    cancel(searchId: string): Promise<void>
    replace(
      path: string,
      query: SearchQuery,
      replacement: string
    ): Promise<{ replacements: number }>
    onResults(cb: (searchId: string, results: SearchFileResult[]) => void): () => void
    onDone(cb: (searchId: string, summary: { files: number; matches: number; truncated: boolean }) => void): () => void
  }

  git: {
    status(): Promise<GitStatus>
    diff(path: string, staged: boolean): Promise<string>
    hunks(path: string): Promise<GitHunk[]>
    fileAtHead(path: string): Promise<string | null>
    stage(paths: string[]): Promise<void>
    unstage(paths: string[]): Promise<void>
    discard(paths: string[]): Promise<void>
    commit(opts: CommitOptions): Promise<{ hash: string }>
    branches(): Promise<GitBranch[]>
    checkout(name: string): Promise<void>
    createBranch(name: string, checkout: boolean): Promise<void>
    log(limit: number): Promise<GitCommit[]>
    stash(action: 'push' | 'pop' | 'list'): Promise<string>
    onChanged(cb: () => void): () => void
  }

  lsp: {
    status(): Promise<LanguageServerStatus[]>
    didOpen(path: string, languageId: string, version: number, text: string): Promise<void>
    didChange(path: string, version: number, text: string): Promise<void>
    didClose(path: string): Promise<void>
    didSave(path: string, text: string): Promise<void>
    /** Generic LSP request; `method` is an LSP method name. */
    request<T = unknown>(path: string, method: string, params: unknown): Promise<T>
    restart(serverId: string): Promise<void>
    onDiagnostics(cb: (path: string, diagnostics: unknown[]) => void): () => void
    onStatusChanged(cb: (status: LanguageServerStatus[]) => void): () => void
  }

  settings: {
    get(): Promise<Settings>
    set(partial: Partial<Settings>): Promise<Settings>
    /** Absolute path of settings.json, so the UI can open it as a file. */
    path(): Promise<string>
  }

  session: {
    get(): Promise<SessionState>
    set(state: SessionState): Promise<void>
  }

  menu: {
    onCommand(cb: (commandId: string) => void): () => void
  }
}

declare global {
  interface Window {
    ide: IdeApi
  }
}
