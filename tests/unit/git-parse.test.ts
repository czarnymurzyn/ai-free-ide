/**
 * Porcelain v2 parsing and diff hunk extraction.
 *
 * Both formats are fiddly enough to be worth testing away from a real
 * repository, particularly the rename case, where the original path arrives
 * as a separate NUL-separated field rather than on the same line.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

const { parseStatus, parseHunks } = await import('../../src/main/git/commands.js')

describe('parseStatus', () => {
  it('reads the branch name', () => {
    const out = parseStatus('# branch.oid abc123\0# branch.head main\0')
    expect(out.isRepo).toBe(true)
    expect(out.branch).toBe('main')
    expect(out.detached).toBe(false)
  })

  it('flags a detached HEAD instead of inventing a branch name', () => {
    const out = parseStatus('# branch.head (detached)\0')
    expect(out.detached).toBe(true)
    expect(out.branch).toBeNull()
  })

  it('reads an ordinary modified file', () => {
    const out = parseStatus('1 .M N... 100644 100644 100644 aaa bbb src/index.ts\0')
    expect(out.changes).toEqual([{ path: 'src/index.ts', status: 'modified', staged: false }])
  })

  it('splits a file that is both staged and modified into two rows', () => {
    // Edit, stage, edit again: the user needs to act on each half separately.
    const out = parseStatus('1 MM N... 100644 100644 100644 aaa bbb src/app.ts\0')
    expect(out.changes).toEqual([
      { path: 'src/app.ts', status: 'modified', staged: true },
      { path: 'src/app.ts', status: 'modified', staged: false }
    ])
  })

  it('reads a staged addition', () => {
    const out = parseStatus('1 A. N... 000000 100644 100644 000 bbb new.ts\0')
    expect(out.changes).toEqual([{ path: 'new.ts', status: 'added', staged: true }])
  })

  it('reads a rename with its original path from the following field', () => {
    const line = '2 R. N... 100644 100644 100644 aaa bbb R100 new/path.ts'
    const out = parseStatus(`${line}\0old/path.ts\0`)
    expect(out.changes).toEqual([
      { path: 'new/path.ts', status: 'renamed', staged: true, originalPath: 'old/path.ts' }
    ])
  })

  it('reads untracked and unmerged entries', () => {
    const out = parseStatus(
      '? untracked.txt\0u UU N... 100644 100644 100644 100644 a b c conflict.ts\0'
    )
    expect(out.changes).toContainEqual({ path: 'untracked.txt', status: 'untracked', staged: false })
    expect(out.changes).toContainEqual({ path: 'conflict.ts', status: 'conflicted', staged: false })
  })

  it('handles a path containing spaces', () => {
    // NUL separation is what makes this work; a line-based parser would need
    // to guess where the path starts.
    const out = parseStatus('1 .M N... 100644 100644 100644 aaa bbb my folder/a file.ts\0')
    expect(out.changes[0]?.path).toBe('my folder/a file.ts')
  })

  it('returns an empty change list for a clean tree', () => {
    const out = parseStatus('# branch.head main\0')
    expect(out.changes).toEqual([])
  })
})

describe('parseHunks', () => {
  it('reads an added block', () => {
    const diff = '@@ -0,0 +1,3 @@\n+a\n+b\n+c\n'
    expect(parseHunks(diff)).toEqual([{ start: 1, count: 3, type: 'added' }])
  })

  it('reads a modified block', () => {
    const diff = '@@ -10,2 +10,2 @@\n-old\n+new\n'
    expect(parseHunks(diff)).toEqual([{ start: 10, count: 2, type: 'modified' }])
  })

  it('anchors a pure deletion to the line after the gap', () => {
    // git reports the line before a removed block; the marker belongs after
    // it so the gutter wedge points at where the text used to be.
    const diff = '@@ -5,3 +4,0 @@\n-gone\n'
    expect(parseHunks(diff)).toEqual([{ start: 5, count: 0, type: 'deleted' }])
  })

  it('treats an omitted count as 1, per the diff format', () => {
    const diff = '@@ -7 +7 @@\n-x\n+y\n'
    expect(parseHunks(diff)).toEqual([{ start: 7, count: 1, type: 'modified' }])
  })

  it('reads several hunks from one diff', () => {
    const diff = ['@@ -1,2 +1,3 @@', '+added', '@@ -20,1 +21,1 @@', '-a', '+b'].join('\n')
    expect(parseHunks(diff)).toHaveLength(2)
  })

  it('returns nothing for an empty diff', () => {
    expect(parseHunks('')).toEqual([])
  })
})
