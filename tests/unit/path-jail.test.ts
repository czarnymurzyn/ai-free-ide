/**
 * The workspace path jail.
 *
 * The renderer names files by absolute path, so containment is what stops a
 * UI bug from reading or writing outside the folder the user opened.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

const { isInside } = await import('../../src/main/workspace/root.js')

describe('isInside', () => {
  const root = '/home/user/project'

  it('accepts paths within the root', () => {
    expect(isInside(root, '/home/user/project')).toBe(true)
    expect(isInside(root, '/home/user/project/src/index.ts')).toBe(true)
    expect(isInside(root, '/home/user/project/a/b/c/d.txt')).toBe(true)
  })

  it('rejects paths outside the root', () => {
    expect(isInside(root, '/home/user')).toBe(false)
    expect(isInside(root, '/etc/passwd')).toBe(false)
    expect(isInside(root, '/home/user/other/file.ts')).toBe(false)
  })

  it('rejects a sibling directory sharing the root as a name prefix', () => {
    // The reason path.relative is used instead of startsWith: a plain string
    // prefix test accepts all three of these.
    expect(isInside(root, '/home/user/project-secrets/creds')).toBe(false)
    expect(isInside(root, '/home/user/project2')).toBe(false)
    expect(isInside(root, '/home/user/projectile/x')).toBe(false)
  })

  it('rejects traversal that escapes the root', () => {
    expect(isInside(root, '/home/user/project/../../../etc/shadow')).toBe(false)
    expect(isInside(root, '/home/user/project/..')).toBe(false)
  })

  it('accepts traversal that stays within the root', () => {
    expect(isInside(root, '/home/user/project/src/../lib/x.ts')).toBe(true)
  })
})
