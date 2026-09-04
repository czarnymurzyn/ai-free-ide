/**
 * Source-control state.
 *
 * Note the absence of any remote concept: no ahead/behind counts, no remote
 * branches, no sync action. The backend refuses those operations, so the UI
 * never offers them.
 */

import { create } from 'zustand'
import type { GitBranch, GitChange, GitCommit, GitStatus } from '@shared/types.js'

interface GitState {
  status: GitStatus
  branches: GitBranch[]
  commits: GitCommit[]
  commitMessage: string
  amend: boolean
  busy: boolean
  error: string | null

  refresh(): Promise<void>
  refreshBranches(): Promise<void>
  refreshLog(): Promise<void>
  setCommitMessage(message: string): void
  setAmend(amend: boolean): void
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(paths: string[]): Promise<void>
  commit(): Promise<void>
  checkout(name: string): Promise<void>
  createBranch(name: string): Promise<void>
  stash(action: 'push' | 'pop'): Promise<void>
}

const EMPTY: GitStatus = { isRepo: false, branch: null, detached: false, changes: [] }

export const useGit = create<GitState>((set, get) => ({
  status: EMPTY,
  branches: [],
  commits: [],
  commitMessage: '',
  amend: false,
  busy: false,
  error: null,

  async refresh() {
    try {
      set({ status: await window.ide.git.status(), error: null })
    } catch (err) {
      set({ status: EMPTY, error: (err as Error).message })
    }
  },

  async refreshBranches() {
    if (!get().status.isRepo) return
    try {
      set({ branches: await window.ide.git.branches() })
    } catch {
      set({ branches: [] })
    }
  },

  async refreshLog() {
    if (!get().status.isRepo) return
    try {
      set({ commits: await window.ide.git.log(100) })
    } catch {
      set({ commits: [] })
    }
  },

  setCommitMessage(commitMessage) {
    set({ commitMessage })
  },

  setAmend(amend) {
    set({ amend })
  },

  async stage(paths) {
    await run(set, () => window.ide.git.stage(paths))
    await get().refresh()
  },

  async unstage(paths) {
    await run(set, () => window.ide.git.unstage(paths))
    await get().refresh()
  },

  async discard(paths) {
    await run(set, () => window.ide.git.discard(paths))
    await get().refresh()
  },

  async commit() {
    const { commitMessage, amend, status } = get()
    const hasStaged = status.changes.some((c) => c.staged)

    await run(set, async () => {
      await window.ide.git.commit({
        message: commitMessage,
        amend,
        // With nothing staged, commit tracked modifications directly -- the
        // behaviour users expect from a commit box with no staged files.
        all: !hasStaged
      })
    })

    if (!get().error) set({ commitMessage: '', amend: false })
    await get().refresh()
    await get().refreshLog()
  },

  async checkout(name) {
    await run(set, () => window.ide.git.checkout(name))
    await get().refresh()
    await get().refreshBranches()
  },

  async createBranch(name) {
    await run(set, () => window.ide.git.createBranch(name, true))
    await get().refresh()
    await get().refreshBranches()
  },

  async stash(action) {
    await run(set, () => window.ide.git.stash(action))
    await get().refresh()
  }
}))

/** Wrap a mutation so every failure lands in one place. */
async function run(
  set: (partial: Partial<GitState>) => void,
  fn: () => Promise<unknown>
): Promise<void> {
  set({ busy: true, error: null })
  try {
    await fn()
  } catch (err) {
    set({ error: (err as Error).message })
  } finally {
    set({ busy: false })
  }
}

/** Group changes into the two sections the panel renders. */
export function partitionChanges(changes: GitChange[]): {
  staged: GitChange[]
  unstaged: GitChange[]
} {
  return {
    staged: changes.filter((c) => c.staged),
    unstaged: changes.filter((c) => !c.staged)
  }
}
