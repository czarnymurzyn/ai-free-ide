/**
 * The git network guard.
 *
 * Git is the only bundled tool that can open a socket, so the allowlist is
 * the second load-bearing piece of the offline promise.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

const { isSubcommandAllowed, isArgAllowed, ALLOWED_SUBCOMMANDS, NETWORK_SUBCOMMANDS, GitBlockedError } =
  await import('../../src/main/git/exec.js')

describe('isSubcommandAllowed', () => {
  it('refuses every network subcommand', () => {
    const network = [
      'push', 'pull', 'fetch', 'clone', 'remote',
      'submodule', 'ls-remote', 'archive', 'send-email',
      'request-pull', 'svn', 'p4', 'daemon', 'credential'
    ]
    for (const subcommand of network) {
      expect(isSubcommandAllowed(subcommand), subcommand).toBe(false)
    }
  })

  it('permits the local subcommands the UI needs', () => {
    const local = [
      'status', 'diff', 'add', 'reset', 'commit', 'branch',
      'checkout', 'switch', 'merge', 'log', 'blame', 'stash',
      'revert', 'show', 'rev-parse', 'ls-files', 'init'
    ]
    for (const subcommand of local) {
      expect(isSubcommandAllowed(subcommand), subcommand).toBe(true)
    }
  })

  it('refuses anything not explicitly listed', () => {
    // The allowlist must fail closed for subcommands nobody thought about.
    expect(isSubcommandAllowed('gc')).toBe(false)
    expect(isSubcommandAllowed('filter-branch')).toBe(false)
    expect(isSubcommandAllowed('')).toBe(false)
    expect(isSubcommandAllowed('push --force')).toBe(false)
  })

  it('keeps the two lists disjoint', () => {
    // A subcommand appearing in both would be a contradiction in intent.
    for (const subcommand of ALLOWED_SUBCOMMANDS) {
      expect(NETWORK_SUBCOMMANDS.has(subcommand), subcommand).toBe(false)
    }
  })
})

describe('isArgAllowed', () => {
  it('refuses flags that turn a local command into a remote or exec one', () => {
    // `git -c protocol.ext.allow=always` and `--upload-pack=<cmd>` are the
    // documented ways to make an otherwise-local command run something else.
    expect(isArgAllowed('-c')).toBe(false)
    expect(isArgAllowed('--upload-pack=/bin/sh')).toBe(false)
    expect(isArgAllowed('--receive-pack=curl')).toBe(false)
    expect(isArgAllowed('--exec-path=/tmp')).toBe(false)
  })

  it('permits ordinary arguments', () => {
    expect(isArgAllowed('--porcelain=v2')).toBe(true)
    expect(isArgAllowed('HEAD')).toBe(true)
    expect(isArgAllowed('--')).toBe(true)
    expect(isArgAllowed('src/main/index.ts')).toBe(true)
    // A file whose name looks alarming is still just a file name, because
    // args are passed as an array and never through a shell.
    expect(isArgAllowed('; rm -rf ~')).toBe(true)
  })
})

describe('GitBlockedError', () => {
  it('explains that a network subcommand was refused by design', () => {
    const error = new GitBlockedError('push', true)
    expect(error.message).toContain('offline by design')
    expect(error.subcommand).toBe('push')
  })

  it('uses a different message for a merely unlisted subcommand', () => {
    expect(new GitBlockedError('gc', false).message).toContain('not permitted')
  })
})
