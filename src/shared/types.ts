/**
 * Types shared between the main process, the preload bridge and the renderer.
 * This file must stay free of any Node or DOM imports so both sides can use it.
 */

export interface DirEntry {
  name: string
  path: string
  kind: 'file' | 'directory' | 'symlink'
  /** Present for files only. */
  size?: number
  mtimeMs: number
}

export interface FileContent {
  path: string
  text: string
  /** Detected end-of-line sequence, preserved on save. */
  eol: '\n' | '\r\n'
  /** mtime at read time; used to detect out-of-band edits before writing. */
  mtimeMs: number
  languageId: string
}

export interface WriteResult {
  path: string
  mtimeMs: number
}

/** A file-system change observed by the workspace watcher. */
export interface WatchEvent {
  type: 'created' | 'changed' | 'deleted' | 'renamed'
  path: string
}

// ---------------------------------------------------------------- terminal

export interface PtySpawnOptions {
  cwd: string
  shell?: string
  cols: number
  rows: number
}

export interface PtySession {
  id: string
  pid: number
  shell: string
}

// ---------------------------------------------------------------- search

export interface SearchQuery {
  pattern: string
  cwd: string
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
  includeGlob?: string
  excludeGlob?: string
  maxResults: number
}

export interface SearchMatch {
  /** 1-based, to match the editor's coordinate space. */
  line: number
  /** 1-based column of the match start. */
  column: number
  length: number
  /** The full text of the matching line, trimmed to a sane width. */
  preview: string
}

export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
}

// ---------------------------------------------------------------- git

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

export interface GitChange {
  path: string
  /** Previous path, for renames. */
  originalPath?: string
  status: GitFileStatus
  staged: boolean
}

export interface GitStatus {
  /** False when the workspace is not a git repository. */
  isRepo: boolean
  branch: string | null
  /** True when HEAD is detached. */
  detached: boolean
  changes: GitChange[]
}

export interface GitBranch {
  name: string
  current: boolean
  /** Short SHA of the branch tip. */
  head: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

/** One contiguous changed region, used for gutter decorations. */
export interface GitHunk {
  /** 1-based start line in the working-tree file. */
  start: number
  /** Number of lines the hunk covers in the working tree. 0 for a pure deletion. */
  count: number
  type: 'added' | 'modified' | 'deleted'
}

// ---------------------------------------------------------------- language servers

export interface LanguageServerSpec {
  id: string
  label: string
  /** Language ids this server handles. */
  languages: string[]
  /** Binary looked up on PATH unless overridden in settings. */
  command: string
  args: string[]
}

export type LanguageServerState = 'inactive' | 'starting' | 'running' | 'failed'

export interface LanguageServerStatus {
  id: string
  label: string
  languages: string[]
  state: LanguageServerState
  /** Resolved absolute path, when the binary was found. */
  binary: string | null
  detail?: string
}

// ---------------------------------------------------------------- settings

export interface Settings {
  'editor.fontFamily': string
  'editor.fontSize': number
  'editor.tabSize': number
  'editor.insertSpaces': boolean
  'editor.wordWrap': 'on' | 'off'
  'editor.minimap': boolean
  'editor.renderWhitespace': 'none' | 'boundary' | 'all'
  'editor.formatOnSave': boolean
  'workbench.theme': 'ide-dark' | 'ide-light'
  'terminal.fontSize': number
  'terminal.shell': string | null
  'files.excludeGlobs': string[]
  /** Explicit binary paths per language-server id, overriding PATH lookup. */
  'lsp.serverPaths': Record<string, string>
}

// ---------------------------------------------------------------- session

export interface SessionState {
  workspaceRoot: string | null
  openFiles: string[]
  activeFile: string | null
  /** Files opened in the second editor group, if it is visible. */
  secondGroupFiles: string[]
  secondGroupActive: string | null
}
