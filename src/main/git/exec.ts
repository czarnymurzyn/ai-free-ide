/**
 * The only place this app invokes git.
 *
 * Git is the one bundled tool that *can* reach the network, so the allowed
 * subcommands are enumerated rather than filtered: anything not on the list
 * fails, which means `push`, `pull`, `fetch`, `clone`, `remote` and friends
 * are refused even if a future caller asks for them by mistake.
 *
 * Two further precautions:
 *   - arguments are passed as an array to execFile, never through a shell, so
 *     a file named `; rm -rf ~` is just a file name
 *   - the environment disables every credential and terminal prompt, so a git
 *     operation can never block the app waiting on hidden input
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getWorkspaceRoot } from '../workspace/root.js'

const execFileAsync = promisify(execFile)

/**
 * Subcommands the IDE may run. Every one of these is local-only: none opens a
 * socket. Keep this list closed -- adding to it is a deliberate decision about
 * the product's central promise, not a routine change.
 */
export const ALLOWED_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'add',
  'reset',
  'restore',
  'commit',
  'branch',
  'checkout',
  'switch',
  'merge',
  'log',
  'blame',
  'stash',
  'revert',
  'show',
  'rev-parse',
  'ls-files',
  'symbolic-ref',
  'for-each-ref',
  'cat-file',
  'init'
])

/**
 * Subcommands that are network operations. Listed explicitly so the error
 * message can say *why* something was refused, rather than just "not allowed".
 */
export const NETWORK_SUBCOMMANDS = new Set([
  'push',
  'pull',
  'fetch',
  'clone',
  'remote',
  'submodule',
  'ls-remote',
  'archive',
  'send-email',
  'request-pull',
  'svn',
  'p4',
  'daemon',
  'credential'
])

export class GitBlockedError extends Error {
  constructor(readonly subcommand: string, isNetwork: boolean) {
    super(
      isNetwork
        ? `git ${subcommand} is a network operation. This IDE is offline by design and does not perform them.`
        : `git ${subcommand} is not permitted by this IDE.`
    )
    this.name = 'GitBlockedError'
  }
}

/**
 * Pure predicate over a subcommand, exported so the guarantee is testable
 * without a repository or a git binary present.
 */
export function isSubcommandAllowed(subcommand: string): boolean {
  return ALLOWED_SUBCOMMANDS.has(subcommand) && !NETWORK_SUBCOMMANDS.has(subcommand)
}

/**
 * Reject flags that would turn an allowed subcommand into a network call or a
 * command execution. `git -c protocol.ext.allow=always ...` and
 * `--upload-pack=<cmd>` are the classic escapes.
 */
const FORBIDDEN_ARG_PATTERNS = [
  /^-c$/, // no ad-hoc config injection
  /^--exec-path/,
  /^--upload-pack/,
  /^--receive-pack/,
  /^--upload-archive/
]

export function isArgAllowed(arg: string): boolean {
  return !FORBIDDEN_ARG_PATTERNS.some((re) => re.test(arg))
}

export interface GitRunOptions {
  /** Defaults to the workspace root. */
  cwd?: string
  /** Text piped to git's stdin, for `commit -F -` and `apply`. */
  stdin?: string
  /** Treat a non-zero exit as success and return the output anyway. */
  tolerateFailure?: boolean
  maxBuffer?: number
}

export interface GitResult {
  stdout: string
  stderr: string
  code: number
}

const BASE_ENV: NodeJS.ProcessEnv = {
  // Never prompt on a terminal the user cannot see.
  GIT_TERMINAL_PROMPT: '0',
  // Never invoke a credential helper or an askpass GUI.
  GIT_ASKPASS: '/bin/false',
  SSH_ASKPASS: '/bin/false',
  GIT_CONFIG_NOSYSTEM: '0',
  // Stable, parseable output regardless of the user's locale.
  LC_ALL: 'C',
  // Paging would hang a non-interactive invocation.
  GIT_PAGER: 'cat',
  PAGER: 'cat'
}

export async function git(
  subcommand: string,
  args: string[] = [],
  options: GitRunOptions = {}
): Promise<GitResult> {
  if (!isSubcommandAllowed(subcommand)) {
    throw new GitBlockedError(subcommand, NETWORK_SUBCOMMANDS.has(subcommand))
  }
  const bad = args.find((a) => !isArgAllowed(a))
  if (bad) throw new Error(`Refused git argument: ${bad}`)

  const cwd = options.cwd ?? getWorkspaceRoot()
  if (!cwd) throw new Error('No workspace is open')

  // --no-optional-locks keeps a background `status` from fighting a concurrent
  // command the user ran in the integrated terminal.
  const argv = ['--no-optional-locks', subcommand, ...args]

  try {
    const { stdout, stderr } = await execFileAsync('git', argv, {
      cwd,
      env: { ...process.env, ...BASE_ENV },
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      windowsHide: true,
      ...(options.stdin !== undefined ? {} : {})
    })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string }
    if (options.tolerateFailure) {
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
    }
    const detail = (e.stderr || e.stdout || e.message || '').trim()
    throw new Error(detail || `git ${subcommand} failed`)
  }
}

/**
 * Variant that pipes stdin, used for commit messages so a message containing
 * quotes, newlines or a leading dash cannot be misread as arguments.
 */
export async function gitWithStdin(
  subcommand: string,
  args: string[],
  stdin: string,
  options: GitRunOptions = {}
): Promise<GitResult> {
  if (!isSubcommandAllowed(subcommand)) {
    throw new GitBlockedError(subcommand, NETWORK_SUBCOMMANDS.has(subcommand))
  }
  const bad = args.find((a) => !isArgAllowed(a))
  if (bad) throw new Error(`Refused git argument: ${bad}`)

  const cwd = options.cwd ?? getWorkspaceRoot()
  if (!cwd) throw new Error('No workspace is open')

  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['--no-optional-locks', subcommand, ...args],
      { cwd, env: { ...process.env, ...BASE_ENV }, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !options.tolerateFailure) {
          reject(new Error((stderr || stdout || err.message).trim()))
          return
        }
        resolve({ stdout, stderr, code: err ? 1 : 0 })
      }
    )
    child.stdin?.end(stdin)
  })
}

/** True when the workspace is inside a git work tree. */
export async function isRepository(cwd?: string): Promise<boolean> {
  try {
    const { stdout, code } = await git('rev-parse', ['--is-inside-work-tree'], {
      cwd,
      tolerateFailure: true
    })
    return code === 0 && stdout.trim() === 'true'
  } catch {
    return false
  }
}
