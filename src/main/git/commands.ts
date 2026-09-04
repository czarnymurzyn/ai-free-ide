/**
 * Local git operations, built on the guarded invoker in ./exec.ts.
 *
 * Parsing uses porcelain v2 with NUL separators throughout: it is the only
 * status format git considers stable across versions, and NUL separation is
 * the only way to handle paths containing spaces, quotes or newlines without
 * guessing.
 */

import type { GitBranch, GitChange, GitCommit, GitFileStatus, GitHunk, GitStatus } from '../../shared/types.js'
import { getWorkspaceRoot, toRelative } from '../workspace/root.js'
import { git, gitWithStdin, isRepository } from './exec.js'

export async function status(): Promise<GitStatus> {
  if (!getWorkspaceRoot() || !(await isRepository())) {
    return { isRepo: false, branch: null, detached: false, changes: [] }
  }

  const { stdout } = await git('status', [
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '-z'
  ])

  return parseStatus(stdout)
}

/**
 * Exported for unit tests: porcelain v2 is fiddly enough that the parser
 * deserves coverage independent of a live repository.
 */
export function parseStatus(stdout: string): GitStatus {
  const fields = stdout.split('\0')
  const changes: GitChange[] = []
  let branch: string | null = null
  let detached = false

  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]
    if (!line) continue

    if (line.startsWith('# branch.head ')) {
      const name = line.slice('# branch.head '.length)
      if (name === '(detached)') {
        detached = true
      } else {
        branch = name
      }
      continue
    }
    if (line.startsWith('#')) continue

    const kind = line[0]

    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(8).join(' ')
      pushChange(changes, xy, path)
    } else if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>
      // The original path follows as the NEXT NUL-separated field.
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(9).join(' ')
      const originalPath = fields[++i] ?? undefined
      pushChange(changes, xy, path, originalPath)
    } else if (kind === 'u') {
      // u <XY> ... <path> -- an unmerged entry
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      changes.push({ path, status: 'conflicted', staged: false })
    } else if (kind === '?') {
      changes.push({ path: line.slice(2), status: 'untracked', staged: false })
    }
    // '!' (ignored) is never requested, so it is not handled here.
  }

  changes.sort((a, b) => a.path.localeCompare(b.path))
  return { isRepo: true, branch, detached, changes }
}

/**
 * One porcelain entry can represent both a staged and an unstaged change to
 * the same file (edit, stage, edit again). That surfaces as two rows, which is
 * what the user needs to see to stage them independently.
 */
function pushChange(out: GitChange[], xy: string, path: string, originalPath?: string): void {
  const staged = xy[0] ?? '.'
  const worktree = xy[1] ?? '.'

  if (staged !== '.') {
    out.push({ path, status: codeToStatus(staged), staged: true, ...(originalPath ? { originalPath } : {}) })
  }
  if (worktree !== '.') {
    out.push({ path, status: codeToStatus(worktree), staged: false, ...(originalPath ? { originalPath } : {}) })
  }
}

function codeToStatus(code: string): GitFileStatus {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'added'
    case 'U': return 'conflicted'
    default: return 'modified'
  }
}

export async function diff(path: string, staged: boolean): Promise<string> {
  const rel = toRelative(path)
  const args = ['--no-color', '--no-ext-diff']
  if (staged) args.push('--cached')
  args.push('--', rel)
  const { stdout } = await git('diff', args, { tolerateFailure: true })
  return stdout
}

/** Contents of a file at HEAD, or null when it is untracked. */
export async function fileAtHead(path: string): Promise<string | null> {
  const rel = toRelative(path)
  const { stdout, code } = await git('show', [`HEAD:${rel}`], { tolerateFailure: true })
  return code === 0 ? stdout : null
}

/**
 * Changed line ranges for the editor's gutter decorations.
 *
 * `-U0` gives hunk headers with no context, so each header describes exactly
 * the changed range: `@@ -oldStart,oldCount +newStart,newCount @@`.
 */
export async function hunks(path: string): Promise<GitHunk[]> {
  const rel = toRelative(path)
  const { stdout, code } = await git(
    'diff',
    ['--no-color', '--no-ext-diff', '-U0', '--', rel],
    { tolerateFailure: true }
  )
  if (code !== 0) return []
  return parseHunks(stdout)
}

export function parseHunks(diffText: string): GitHunk[] {
  const out: GitHunk[] = []
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm

  let match: RegExpExecArray | null
  while ((match = re.exec(diffText)) !== null) {
    const oldCount = match[2] === undefined ? 1 : Number(match[2])
    const newStart = Number(match[3])
    const newCount = match[4] === undefined ? 1 : Number(match[4])

    if (newCount === 0) {
      // Pure deletion. git reports the line *before* the removed block, so the
      // marker belongs on the following line to point at the gap.
      out.push({ start: newStart + 1, count: 0, type: 'deleted' })
    } else if (oldCount === 0) {
      out.push({ start: newStart, count: newCount, type: 'added' })
    } else {
      out.push({ start: newStart, count: newCount, type: 'modified' })
    }
  }
  return out
}

export async function stage(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await git('add', ['--', ...paths.map(toRelative)])
}

export async function unstage(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  // `reset -q HEAD --` works whether or not the repo has any commits yet,
  // where `restore --staged` needs an existing HEAD.
  const hasHead = await hasCommits()
  if (hasHead) {
    await git('reset', ['-q', 'HEAD', '--', ...paths.map(toRelative)])
  } else {
    await git('reset', ['-q', '--', ...paths.map(toRelative)])
  }
}

export async function discard(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await git('checkout', ['--', ...paths.map(toRelative)], { tolerateFailure: true })
}

export async function commit(
  message: string,
  amend: boolean,
  all: boolean
): Promise<{ hash: string }> {
  if (!message.trim() && !amend) throw new Error('A commit message is required')

  const args: string[] = []
  if (all) args.push('--all')
  if (amend) args.push('--amend')
  // Read the message from stdin so its content is never parsed as arguments.
  args.push('--file', '-')

  await gitWithStdin('commit', args, message)
  const { stdout } = await git('rev-parse', ['HEAD'])
  return { hash: stdout.trim() }
}

export async function branches(): Promise<GitBranch[]> {
  const { stdout } = await git('for-each-ref', [
    '--format=%(refname:short)%09%(objectname:short)%09%(HEAD)',
    'refs/heads'
  ])

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', head = '', marker = ''] = line.split('\t')
      return { name, head, current: marker.trim() === '*' }
    })
}

export async function checkout(name: string): Promise<void> {
  await git('checkout', [name])
}

export async function createBranch(name: string, checkoutAfter: boolean): Promise<void> {
  if (checkoutAfter) {
    await git('checkout', ['-b', name])
  } else {
    await git('branch', [name])
  }
}

export async function log(limit: number): Promise<GitCommit[]> {
  if (!(await hasCommits())) return []

  // Unit-separator delimited so subjects containing tabs still parse.
  const { stdout } = await git('log', [
    `--max-count=${Math.max(1, Math.min(limit, 1000))}`,
    '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s',
    '--date=short'
  ])

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', shortHash = '', author = '', date = '', subject = ''] = line.split('\x1f')
      return { hash, shortHash, author, date, subject }
    })
}

export async function stash(action: 'push' | 'pop' | 'list'): Promise<string> {
  const { stdout, stderr } = await git('stash', [action], { tolerateFailure: true })
  return stdout || stderr
}

/** False in a freshly `git init`-ed repository, where HEAD does not resolve. */
async function hasCommits(): Promise<boolean> {
  const { code } = await git('rev-parse', ['--verify', 'HEAD'], { tolerateFailure: true })
  return code === 0
}
